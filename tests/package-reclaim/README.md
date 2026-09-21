# Stage-lighting catalog reclaim evidence

## Test-first checkpoint

Before changing `data/stage-lighting.js`, captured the original 149 catalog rows as ordinary objects in `docs/catalog-source/stage-lighting.json`. The immutable SHA-256 of `JSON.stringify(originalProducts)` is `8e821adbacbf54cc4a80861d4d1ed9b163fd2ffd287ec83c19d2d7e924d07582`.

`node tests/package-reclaim/catalog-equivalence.cjs` passed against the original module before the representation change. It checked the original exports, records, field order/presence, 121 DMX fixtures, index relationships, channel modes, mutability, and catalog consumers. The source snapshot and test are excluded from the Mini Program package.

## Generated representation

`docs/catalog-source/stage-lighting.json` is the only maintained catalog. The generator derives ordered property schemas from each ordinary object and emits the compact `data/stage-lighting.js` representation. Run `node tests/package-reclaim/generate-stage-lighting.cjs` to regenerate and `node tests/package-reclaim/generate-stage-lighting.cjs --check` to verify byte-for-byte freshness without writing.

The current generated module is 39,301 bytes; the original module was 68,713 bytes, a source-file reduction of 29,412 bytes. This is not the accepted package reclaim measurement; only `tests/release-check.js` release accounting determines package savings.
