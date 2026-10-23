# CityOS Paperclip adapter

This external adapter targets Paperclip source `6dda8cc2b75e211dc62af264bfd0994f602099d1`, adapter-utils/server `0.3.1`, and `cityos.paperclip-integration.v1`. It has no Paperclip core patch and starts no CLI or provider process.

Install the packed package through Paperclip's external adapter loader. The trusted service bootstrap must install a `CityosAdapterRuntime` using the existing CityOS workload provider and discovered Engineering integration routes. Config and issue metadata cannot provide credentials, tenant bindings, qualification or approval. Each process serves one CityOS tenant trust boundary.

Planning/status qualification precedes execution qualification. Missing bindings or qualification leave diagnostics failed and execution unavailable. Proposals never approve work. Execution returns success only after the canonical owner supplies a matching terminal receipt; ambiguous delivery retains the original operation identity, cancellation requires confirmed readback, and usage comes from the final logical operation receipt.

Bootstrap captures the installed client methods and requires literal owner acknowledgements. Work coordinates are copied before asynchronous rechecks. An uncertain cancellation is replayed with the same cancellation operation identity while authoritative state remains nonterminal, within the existing polling limit.

Run `node --test extensions/cityos-adapter/adapter.test.mjs` with the selected verification runtime. These port-level regressions do not qualify the Paperclip loader, image, database migration, installed CityOS endpoints or activation. Those checks require the real selected host and installation before enabling this adapter.
