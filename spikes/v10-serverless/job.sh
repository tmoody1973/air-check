#!/usr/bin/env bash
# Spike V10 (throwaway): join two 1-hour WAVs and encode one MP3 inside a Nebius Serverless Job.
# Synthetic tones stand in for 9125.wav / 9126.wav (44.1 kHz, 16-bit stereo, about 635 MB each).
set -euo pipefail
cd /tmp
echo "cpus=$(nproc) mem=$(free -m | awk '/Mem/{print $2}')MB"
t0=$(date +%s)
ffmpeg -hide_banner -loglevel error -f lavfi -i "sine=frequency=440:duration=3600:sample_rate=44100" -ac 2 -c:a pcm_s16le h1.wav
ffmpeg -hide_banner -loglevel error -f lavfi -i "sine=frequency=660:duration=3600:sample_rate=44100" -ac 2 -c:a pcm_s16le h2.wav
t1=$(date +%s)
ls -l h1.wav h2.wav | awk '{print "input", $NF, $5, "bytes"}'
printf "file 'h1.wav'\nfile 'h2.wav'\n" > list.txt
ffmpeg -hide_banner -loglevel error -f concat -safe 0 -i list.txt -c:a libmp3lame -b:a 192k show.mp3
t2=$(date +%s)
echo "output show.mp3 $(stat -c %s show.mp3) bytes"
echo "duration_s $(ffprobe -v error -show_entries format=duration -of csv=p=0 show.mp3)"
echo "hour1_duration_s $(ffprobe -v error -show_entries format=duration -of csv=p=0 h1.wav)"
echo "sha256 $(sha256sum show.mp3 | cut -d' ' -f1)"
echo "make_wavs_s $((t1-t0)) join_encode_s $((t2-t1))"
echo "V10_DONE"
