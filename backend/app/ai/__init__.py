"""
AI chat over the CDR/CODR lake.

A free-form question in, a text answer out, with the model reaching the data
only through two tools: the pre-built dashboard panels, and guarded read-only
SQL. Self-contained — it imports from `app.cdr` but changes nothing there.

Nothing in this package is imported at application startup beyond the router,
and no provider SDK is imported until a provider is actually chosen, so the CDR
dashboards keep working with no AI configured at all.
"""
