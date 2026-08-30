"""Authority rules for the Python LangGraph runtime boundary."""

LANGGRAPH_AUTHORITY = "python-langgraph"

# These names are rejected as orchestration authorities.  They are data values,
# not imports or SDK integrations: this keeps the local registry provider-free.
DENIED_COMPETING_AUTHORITIES = frozenset(
    {
        "typescript",
        "javascript",
        "openai-agents",
        "bedrock-agents",
        "bedrock-flows",
        "agents",
        "flows",
    }
)


class AuthorityViolation(ValueError):
    """Raised when a component attempts to own workflow orchestration."""


def assert_langgraph_authority(authority: str) -> None:
    """Allow only the canonical Python LangGraph orchestration authority."""

    if authority != LANGGRAPH_AUTHORITY:
        raise AuthorityViolation(
            f"LangGraph is the sole orchestration authority; rejected {authority!r}"
        )
