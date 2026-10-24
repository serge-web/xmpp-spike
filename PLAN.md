# Spike plan

This is a mini plan for running [`SPIKE-BRIEF.md`](SPIKE-BRIEF.md). The brief allows about 3 working days per server, and a check that blocks for more than half a day is recorded as BLOCKED.

## Approach

1. **Build the shared suite on the first server.** The checks are written once, against ejabberd, without anything server-specific. Only the provisioning adapter and the config differ per server.
2. **Run the remaining servers.** For each one: write the compose stack and the adapter, run the suite, then do the server-specific checks (S8 operations and S9 module effort).
3. **Compare and recommend** using the decision rule in §7 of the brief.

### Server order

| Order | Server | Why |
|---|---|---|
| 1 | ejabberd | Its official image is pinned and running. Ad-hoc admin commands (`mod_adhoc_api`) make it a good first test of S4. |
| 2 | Prosody | Small, simple config. Its admin commands and MUC/PubSub behaviour differ from ejabberd's, which tests whether the suite really is server-neutral. |
| 3 | OpenFire | Heaviest stack (Java, embedded DB, setup wizard). Most of its admin functions are REST plugins, so S4 is its riskiest check. |

## Schedule

Days are working days, starting on Monday 26 October 2026.

```mermaid
gantt
    title WRX1 XMPP server spike
    dateFormat YYYY-MM-DD
    excludes weekends

    section Foundation
    Repo scaffold, harness, fixture       :done, milestone, f1, 2026-10-24, 0d

    section ejabberd
    Compose stack + S0 connectivity       :active,  e1, 2026-10-26, 1d
    Provisioning adapter (admin creds)    :         e2, after e1, 1d
    S1 read-only, S2 PubSub ACLs          :         e3, after e2, 1d
    S3 size, S4 admin ops, S5 MAM, S10    :         e4, after e3, 1d
    S6 S7 S11 S12 (record only)           :         e5, after e4, 1d
    S8 ops + S9 module + decision record  :         e6, after e5, 1d
    Milestone ejabberd done               :milestone, m1, after e6, 0d

    section Prosody
    Compose stack + adapter               :         p1, after m1, 1d
    Run suite S0-S12, note quirks         :         p2, after p1, 1d
    S8 ops + S9 module + decision record  :         p3, after p2, 1d
    Milestone Prosody done                :milestone, m2, after p3, 0d

    section OpenFire
    Compose stack, setup automation       :         o1, after m2, 1d
    Adapter (REST vs ad-hoc assessment)   :         o2, after o1, 1d
    Run suite S0-S12, note quirks         :         o3, after o2, 1d
    S8 ops + S9 module + decision record  :         o4, after o3, 1d
    Milestone OpenFire done               :milestone, m3, after o4, 0d

    section Decision
    summary.md, recommendation, mock list :         d1, after m3, 1d
    Human: air-gapped host install (S8)   :crit,    h1, after d1, 2d
```

ejabberd takes the longest because the shared suite is built during its days. Prosody and OpenFire then reuse the suite. OpenFire gets an extra day for its setup wizard and its REST-heavy admin surface.

## Milestones and outputs

| Milestone | Output | Notification |
|---|---|---|
| ejabberd done | `results/ejabberd.md`, stanzas, compose stack | ntfy |
| Prosody done | `results/prosody.md`, stanzas, compose stack | ntfy |
| OpenFire done | `results/openfire.md`, stanzas, compose stack | ntfy |
| Decision | `results/summary.md` with the recommendation and the list of behaviours the mock must reproduce | ntfy |

## Stop and escalate points

- **No server passes S1:** stop and report. The SRD defers this decision (PLY-39).
- **A ground rule needs relaxing** (for example, a custom module or a REST secret): ask a human first.
- **S8 air-gapped install:** this needs real hardware, so the team verifies it by hand. It is marked pending in each decision record.
- **Early elimination:** a server that fails a mandatory check (S0–S5 or S10) is out of the running. Its remaining checks are run only for the mock record and may be cut short.
