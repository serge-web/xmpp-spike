# S9 escape hatch: ejabberd hello-world module

Never enabled in the spike stack. Reproduce in a throwaway container:

```bash
IMG=ejabberd/ecs:26.09@sha256:8ebff5b218e686d5dbd93850ea17556d5b70d4c15918c3613e9302a357798e0e
docker run -d --name wrx-ejd-s9 $IMG
docker exec wrx-ejd-s9 mkdir -p /home/ejabberd/.ejabberd-modules/sources
docker cp mod_hello wrx-ejd-s9:/home/ejabberd/.ejabberd-modules/sources/
docker exec -u root wrx-ejd-s9 chown -R ejabberd /home/ejabberd/.ejabberd-modules
docker exec wrx-ejd-s9 ejabberdctl module_install mod_hello   # compiles in the running VM; copies conf/
docker restart wrx-ejd-s9
docker logs wrx-ejd-s9 | grep "hello from"                  # -> "mod_hello: hello from localhost"
```

Notes: Erlang (or Elixir); `gen_mod` behaviour; no external toolchain (ejabberd's `ext_mod` compiles
from `~/.ejabberd-modules/sources/<mod>/src` using the bundled compiler). Module config is loaded from
`~/.ejabberd-modules/<mod>/conf/<mod>.yml`. The source dir must be writable (compile output goes to
`sources/<mod>/ebin`). Time to working hello world: ~20 minutes.
