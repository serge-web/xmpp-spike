%% S9 escape-hatch probe: minimal ejabberd module. Never enabled for other checks.
-module(mod_hello).
-behaviour(gen_mod).
-export([start/2, stop/1, reload/3, depends/2, mod_options/1, mod_doc/0]).
-include("logger.hrl").

start(Host, _Opts) ->
    ?INFO_MSG("mod_hello: hello from ~ts", [Host]),
    ok.
stop(_Host) -> ok.
reload(_Host, _NewOpts, _OldOpts) -> ok.
depends(_Host, _Opts) -> [].
mod_options(_Host) -> [].
mod_doc() -> #{desc => <<"Hello world probe">>}.
