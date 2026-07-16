from pydantic import BaseModel, ConfigDict, Field


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Lead(BaseModel):
    id: str
    dataset_id: str
    user_id: str
    owner_name: str
    property_address: str | None = None
    city: str | None = None
    province: str | None = None
    postal_code: str | None = None


class SourceCandidate(StrictModel):
    url: str
    title: str
    match_reason: str
    claimed_emails: list[str] = Field(max_length=8)
    claimed_phones: list[str] = Field(max_length=8)
    confidence: int = Field(ge=0, le=100)


class DiscoveryResult(StrictModel):
    candidates: list[SourceCandidate] = Field(max_length=8)
    summary: str = Field(max_length=500)


class ScrapedEvidence(BaseModel):
    url: str
    domain: str
    title: str
    match_reason: str
    emails: list[str] = Field(default_factory=list)
    phones: list[str] = Field(default_factory=list)
    snippet: str = ""
    confidence: int = Field(default=0, ge=0, le=100)
