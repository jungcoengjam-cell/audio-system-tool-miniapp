# P2 internal source-byte budget revision — 2026-09-24

This explicit internal source-byte allocation is measured from checkpoint HEAD
`a5de5a6e...`, which contains the Venue, LED, and Camera checkpoint. At that
baseline, effective source package bytes were 2,099,168 total, 826,778 main
package JavaScript, and 250,212 WXML.

The total source-byte warning allocation is now 2,116,608 bytes (2,067 KiB),
and the main-package JavaScript allocation is 837,632 bytes (818 KiB). The
subpackage JavaScript, WXML, WXSS, media, and single-JavaScript allocations
are unchanged. At the checkpoint baseline, the resulting headroom is 17,440
total bytes, 10,854 main-package JavaScript bytes, and 1,692 WXML bytes.

The earlier implementation-size estimate exceeded the previous internal
allocations. This revision explicitly assigns the additional internal source
budget for that work; the figures remain source-byte checks. They do not
certify or represent WeChat's compiled-package limit.
