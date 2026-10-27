import { SignIn } from "@clerk/nextjs";

export const dynamic = "force-dynamic";

const TRUST = [
  "The agent runs in a sandbox that blocks every network request not on its allow-list.",
  "It never holds your Box, Drive, Dropbox or Mixcloud credentials.",
  "Every request it makes is logged where you can read it.",
];

const appearance = {
  variables: {
    colorPrimary: "#0E6A5B",
    colorText: "#1C1B18",
    colorTextSecondary: "#655F54",
    colorBackground: "#FFFFFF",
    colorInputBackground: "#FFFFFF",
    colorInputText: "#1C1B18",
    borderRadius: "10px",
    fontFamily: "var(--font-dm-sans), sans-serif",
  },
  elements: {
    rootBox: "w-full",
    cardBox: "w-full shadow-none rounded-card border border-line",
    card: "shadow-none",
    formButtonPrimary: "bg-signal hover:bg-signal-deep min-h-11 shadow-none normal-case",
    socialButtonsBlockButton: "min-h-11 border-line-strong shadow-none",
    formFieldInput: "min-h-11 border-line-strong shadow-none",
    footer: "hidden",
  },
};

export default function SignInPage() {
  return (
    <main className="flex min-h-screen flex-wrap bg-paper">
      <section className="flex min-w-0 flex-[1_1_440px] flex-col justify-between gap-12 bg-ink px-8 py-14 text-paper md:px-16">
        <div className="flex items-center gap-3">
          <svg width="36" height="28" viewBox="0 0 36 28" fill="none" stroke="#5CC8B2" strokeWidth="3" strokeLinecap="round" aria-hidden="true">
            <path d="M3 14v0M9 8v12M15 3v22M21 9v10M27 5v18M33 12v4" />
          </svg>
          <span className="font-serif text-[34px] leading-none">Air Check</span>
        </div>
        <div className="flex max-w-[520px] flex-col gap-6">
          <h1 className="font-serif text-[56px] font-normal leading-[1.04]">
            Every show, ready to post. Nothing goes out without you.
          </h1>
          <p className="text-[17px] leading-[1.55] text-line-strong">
            Air Check reads the tracklist, the show notes and the audio, drafts the Mixcloud package, and waits for your approval.
          </p>
        </div>
        <ul className="flex list-none flex-col gap-3.5 p-0 text-[15px] text-line-strong">
          {TRUST.map((line, i) => (
            <li key={line} className="flex items-baseline gap-3">
              <span className="font-mono text-xs text-signal-on-dark">{`0${i + 1}`}</span>
              {line}
            </li>
          ))}
        </ul>
      </section>

      <section className="flex min-w-0 flex-[1_1_440px] items-center justify-center px-8 py-14">
        <div className="flex w-full max-w-[400px] flex-col gap-6">
          <SignIn appearance={appearance} fallbackRedirectUrl="/today" />
          <p className="m-0 text-[15px] text-muted">
            Here to review the hackathon entry?{" "}
            <a href="/demo" className="inline-flex min-h-11 items-center font-medium text-signal underline hover:text-signal-deep">
              Open the demo workspace
            </a>
          </p>
        </div>
      </section>
    </main>
  );
}
