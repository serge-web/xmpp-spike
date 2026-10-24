#!/bin/bash
# S9: build the hello-world / read-only sketch plugin jar with plain javac (no Maven), compiling
# against the jars shipped in the pinned OpenFire image. Output: s9-plugin/out/wrxreadonly.jar
set -euo pipefail
cd "$(dirname "$0")"
OPENFIRE_IMAGE=ghcr.io/igniterealtime/openfire:v5.1.2@sha256:5c9119cd4ea6edaa4dfead0cccbeb98847614d47d61715de8fd98c3b189670d6
# Same JDK major/patch as the image's JRE (17.0.19+10); tag published 2026-08-19.
JDK_IMAGE=eclipse-temurin:17.0.19_10-jdk@sha256:0861abc5eb3aa441471c1017172ed241210ca480dae911f5539df85d66166f90
rm -rf out && mkdir -p out/lib out/stage/classes
cid=$(docker create "$OPENFIRE_IMAGE")
docker cp "$cid:/usr/local/openfire/lib/." out/lib/ >/dev/null
docker rm "$cid" >/dev/null
docker run --rm --network none -v "$PWD:/w" -w /w "$JDK_IMAGE" \
  javac --release 17 -cp 'out/lib/*' -d out/stage/classes src/org/wrx/spike/openfire/WrxReadOnlyPlugin.java
cp plugin.xml out/stage/
# OpenFire plugin layout: plugin.xml at the root, classes/ (and optionally lib/*.jar) beside it.
docker run --rm --network none -v "$PWD:/w" -w /w/out/stage "$JDK_IMAGE" jar --create --file ../wrxreadonly.jar plugin.xml classes
rm -rf out/lib out/stage
ls -l out/wrxreadonly.jar
