#!/bin/bash
# S8: run INSIDE the offline container (docker cp + docker exec) to prove the XMPP service answers
# with no network: opens a c2s stream on loopback and prints the advertised stream features.
exec 3<>/dev/tcp/127.0.0.1/5222
printf "<?xml version='1.0'?><stream:stream to='localhost' xmlns='jabber:client' xmlns:stream='http://etherx.jabber.org/streams' version='1.0'>" >&3
timeout 3 head -c 600 <&3
echo
