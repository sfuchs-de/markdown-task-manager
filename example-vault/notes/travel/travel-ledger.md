---
kind: travel-ledger
id: travel-ledger
title: Example travel ledger
domain: admin
area: travel
module: travel
research_account_limit_usd: 5000
ledger:
  - id: methods-summit-rail
    trip_key: methods-summit
    trip_title: Methods Summit
    item: Fictional round-trip rail estimate
    category: transport
    estimate: 120
    currency: USD
    status: approved
    reimbursable: true
    counts_against_research_account: true
    source: synthetic example
  - id: methods-summit-room
    trip_key: methods-summit
    trip_title: Methods Summit
    item: Fictional one-night lodging estimate
    category: lodging
    estimate: 180
    currency: USD
    status: approval_needed
    reimbursable: true
    counts_against_research_account: false
    source: synthetic example
---
# Example travel ledger

All amounts and coverage rules are invented.
