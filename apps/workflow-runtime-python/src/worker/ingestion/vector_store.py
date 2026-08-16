from __future__ import annotations

from typing import Any

from langchain_community.document_loaders import PyPDFLoader, TextLoader, UnstructuredURLLoader
from langchain_postgres import PGVector
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_openai import OpenAIEmbeddings

from worker.core.config import RuntimeSettings, get_settings


def select_loader(source: str) -> Any:
    if source.startswith(("http://", "https://")):
        return UnstructuredURLLoader(urls=[source])
    if source.endswith(".pdf"):
        return PyPDFLoader(source)
    return TextLoader(source, autodetect_encoding=True)


def build_splitter(settings: RuntimeSettings | None = None) -> RecursiveCharacterTextSplitter:
    settings = settings or get_settings()
    return RecursiveCharacterTextSplitter(
        chunk_size=settings.ingestion_chunk_size,
        chunk_overlap=settings.ingestion_chunk_overlap,
        add_start_index=True,
    )


def build_embeddings(settings: RuntimeSettings | None = None) -> OpenAIEmbeddings:
    settings = settings or get_settings()
    if not settings.openai_api_key:
        raise RuntimeError("OPENAI_API_KEY is required for vector ingestion.")
    return OpenAIEmbeddings(model=settings.embeddings_model, api_key=settings.openai_api_key)


def build_vector_store(settings: RuntimeSettings | None = None) -> PGVector:
    settings = settings or get_settings()
    return PGVector(
        embeddings=build_embeddings(settings),
        collection_name=settings.vector_collection,
        connection=settings.postgres_dsn,
        use_jsonb=True,
    )


def ingest_sources(sources: list[str], metadata: dict[str, str] | None = None) -> int:
    settings = get_settings()
    splitter = build_splitter(settings)
    store = build_vector_store(settings)
    metadata = metadata or {}
    docs = []
    for source in sources:
        loaded = select_loader(source).load()
        for document in splitter.split_documents(loaded):
            document.metadata.update({"source": source, **metadata})
            docs.append(document)
    if not docs:
        return 0
    store.add_documents(docs)
    return len(docs)
