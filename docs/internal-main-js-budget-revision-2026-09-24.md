# Internal main-package JavaScript budget revision

The project's internal warning limit for main-package JavaScript was revised from 813,056 bytes (794 KiB) to 829,440 bytes (810 KiB), an increase of 16,384 bytes. At the time of that revision, measured main-package usage was 801,288 bytes, leaving 28,152 bytes of headroom under the revised limit.

This is an explicit internal budget revision after package reclaim removed 29,412 bytes of main-package JavaScript and the physical iPhone test rejected LED subpackaging because an uncached first offline entry failed. The LED module remains in the main package to preserve the first-use-offline requirement.

At the time of that revision, the effective package measured 2,073,344 / 2,100,224 bytes, leaving 26,880 bytes. The total-package limit remains 2,100,224 bytes. The subpackage JavaScript limit remains 813,056 bytes (794 KiB); WXML, WXSS, media, and single-JavaScript limits are unchanged. These are project warning limits, not platform limits.

For the later Venue, LED, and Camera structured-operation checkpoint and its verification status, see [p2-structured-operation-checkpoint-2026-09-24.md](p2-structured-operation-checkpoint-2026-09-24.md).
