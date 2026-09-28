"""
The two tools the model can call.

Tier A (`structured`) wraps the pre-built dashboard panels: fixed SQL, bound
parameters, domain rules already applied. Tier B (`ad_hoc_sql`) runs model-
written SQL behind the guard, for the questions the catalogue can't express.

Both return `(content, is_error)` rather than raising, because an error here is
something the model reads and recovers from, not a request failure.
"""

from app.ai.tools.ad_hoc_sql import RUN_QUERY_TOOL, run_cdr_query
from app.ai.tools.structured import GET_PANEL_TOOL, get_cdr_panel

__all__ = ["GET_PANEL_TOOL", "get_cdr_panel", "RUN_QUERY_TOOL", "run_cdr_query"]
