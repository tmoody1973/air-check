# Nebius setup: CLI, profile and the Air Check VM

Written Oct 19, 2026 from Nebius documentation (CLI install, CLI quickstart, compute quickstart). Commands marked **(confirm)** were not in the pages read; check them with `--help` before relying on them. Record what actually happened in `docs/SPIKES.md` and anything awkward in `docs/FRICTION_LOG.md` (it feeds the feedback write-up).

## 0. Two different credentials (do not mix them up)

| Credential | What it is for | Where it comes from |
|---|---|---|
| **Nebius CLI profile** | Creating and managing cloud resources (the VM, disk, network). Used by you or Claude Code on your laptop | `nebius profile create` (section 2) |
| **Token Factory API key** (`NEBIUS_API_KEY`) | Calling Nemotron and other models | Token Factory console. Base URL `https://api.tokenfactory.nebius.com/v1/`, sent as a Bearer token |

Air Check running on the VM needs only the second one. The CLI profile never goes on the VM, into the repo, or into the sandbox.

## 1. Install the CLI

Ubuntu or macOS:

```bash
curl -sSL https://artifacts.nebius.cloud/cli/install.sh | bash
exec -l $SHELL
nebius version
```

If `nebius version` prints a version, it worked. A browser-based Cloud Shell in the Nebius web console is available as an alternative if installing locally is a problem.

## 2. Create a profile

```bash
nebius profile create
```

Answer the prompts:

1. Profile name: for example `airc`.
2. API endpoint: keep the default (`api.nebius.cloud`).
3. Authorization type: **`federation`** (default). This logs the CLI in as you through a browser.
4. Federation endpoint: keep the default (`auth.nebius.com`).
5. A browser tab opens. Log in to the Nebius web console if asked. It says "Login is successful, you may close the browser tab".
6. Back in the terminal, choose the tenant if you have more than one.
7. Choose the project to use as the profile default. Write the project name down.

**Federation or service account?** Federation acts as you and needs a browser, so use it on your laptop. A service account is a separate machine identity with its own key file, no browser, and only the permissions you grant. Use one if Claude Code or a script runs somewhere with no browser (a cloud container, CI, the VM itself). Nebius has a docs page on authenticating in environments without a browser. Nothing running as part of Air Check should hold CLI credentials.

## 3. Create the VM

Prerequisites: the configured CLI, `jq`, and an SSH key pair (`ssh-keygen -t ed25519` if you have none).

```bash
# 3a. Subnet (first one in the project)
export SUBNET_ID=$(nebius vpc subnet list --format jsonpath='{.items[0].metadata.id}')

# 3b. Cloud-init that installs your public key for a non-root user
export USER_DATA=$(jq -Rrs '.' <<EOF
#cloud-config
users:
  - name: user
    sudo: ALL=(ALL) NOPASSWD:ALL
    shell: /bin/bash
    ssh_authorized_keys:
      - $(cat ~/.ssh/id_ed25519.pub)
EOF
)
```

Pick a CPU platform, preset and image. Nebius's example uses a GPU platform and an image with NVIDIA drivers; **Air Check needs neither** because Token Factory does the model work. Find the CPU options **(confirm)**:

```bash
nebius compute platform list
nebius compute image --help        # find the command that lists public images
```

Sizing guide: at least 4 vCPU and 16 GB RAM; boot disk **100 GiB or more** (Docker images, the NemoClaw sandbox build, plus about 3 GB scratch for each show in flight). Use a plain Ubuntu 24.04 image family.

```bash
export AIRC_VM_ID=$(nebius compute instance create \
  --name airc-vm \
  --resources-platform <CPU_PLATFORM> \
  --resources-preset <PRESET> \
  --boot-disk-managed-disk-name airc-vm-disk-1 \
  --boot-disk-managed-disk-type network_ssd \
  --boot-disk-managed-disk-size-gibibytes 100 \
  --boot-disk-managed-disk-block-size-bytes 4096 \
  --boot-disk-managed-disk-source-image-family-image-family <UBUNTU_IMAGE_FAMILY> \
  --boot-disk-attach-mode READ_WRITE \
  --cloud-init-user-data "$USER_DATA" \
  --network-interfaces "[{\"name\": \"eth0\", \"subnet_id\": \"$SUBNET_ID\", \"ip_address\": {}, \"public_ip_address\": {}}]" \
  --format jsonpath='{.metadata.id}')

export AIRC_IP=$(nebius compute instance get --id $AIRC_VM_ID --format json \
  | jq -r '.status.network_interfaces[0].public_ip_address.address | split("/")[0]')

ssh user@$AIRC_IP
```

If the create command is rejected for quota or billing, stop and fix that first. It is the Day 1 blocker called out in the PRD.

## 4. Prepare the VM

On the VM:

```bash
# Docker and Compose (standard Docker convenience script)
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER && newgrp docker
docker version && docker compose version
```

Then run spike V1 from `BUILD_PLAN.md` (the NemoClaw installer). Set `TELEGRAM_BOT_TOKEN` before the first sandbox build.

## 5. Network exposure

Goal: the world can reach only the console over HTTPS (443). The NemoClaw dashboard (18789) and API (8642) stay on loopback.

- **SSH (22)** is needed for administration. Restrict it to your own IP address, or reach the VM through an SSH tunnel. Do not leave it open to everyone.
- How Nebius restricts inbound traffic (security groups or similar) was not in the pages read. **(confirm)** in the console or `nebius vpc --help`. If it is not available, use the host firewall as a second layer.
- **Docker gotcha:** ports published by Docker bypass `ufw`. In `docker-compose.yml`, bind anything internal to `127.0.0.1` (for example `127.0.0.1:18789:18789`) and publish only the reverse proxy on 443.
- The AgentMail webhook arrives at the console over 443 and is verified by its signature.

## 6. Keys and secrets

- Token Factory key: create it in the Token Factory console and put it in the VM's env file (`NEBIUS_API_KEY`). Never paste keys into chat or commit them.
- Service-account key files (if used) stay outside the repo; add the path to `.gitignore`.
- Ingest worker, publisher and Crate keep separate env files from the agent (see `ARCHITECTURE.md` section 3.0).

## 7. Using Claude Code with the CLI

Claude Code can run `nebius` commands for you. Because the profile can create and delete real resources:

- Use a dedicated project for Air Check so nothing else is at risk.
- Ask Claude Code to show each `create` or `delete` command before running it.
- The Nebius MCP server listed on LobeHub (four tools, wraps the CLI) is optional. The CLI does the same job and is easier to audit.

## 8. Cost and teardown

- Stopping or deleting the VM when idle saves credits. The compute quickstart page did not cover deletion **(confirm)**: look at `nebius compute instance --help` or the VM management docs.
- Before Oct 30, confirm the demo VM will stay up through judging, and note the date you plan to shut it down in the README.
