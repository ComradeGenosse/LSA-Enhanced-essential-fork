"""GT0 private source-reference graph from existing Extract-E0Assets.ps1 manifest.

An archive entry and its references establish possible provenance, NOT live
active IPL/DLC/mod precedence. No binary YBN/YMAP/YTYP content is read here.
"""
from __future__ import annotations

import collections
import hashlib
from pathlib import PurePosixPath

from gt0 import GT0Error


def joaat(value):
    h = 0
    for b in value.lower().encode("utf-8"):
        h = (h + b) & 0xFFFFFFFF
        h = (h + (h << 10)) & 0xFFFFFFFF
        h ^= h >> 6
    h = (h + (h << 3)) & 0xFFFFFFFF
    h ^= h >> 11
    h = (h + (h << 15)) & 0xFFFFFFFF
    return h


def string_path(path):
    if not isinstance(path, str) or not path or ".." in path.replace("\\", "/").split("/"):
        raise GT0Error("source manifest contains missing/traversing asset path")
    return path.replace("\\", "/").lower()


def graph_from_extraction(private_manifest):
    if not isinstance(private_manifest, dict) or private_manifest.get("schemaVersion") != 1:
        raise GT0Error("unrecognized private extracted-asset manifest")
    assets = private_manifest.get("assets")
    if not isinstance(assets, list) or len(assets) > 10000:
        raise GT0Error("expected bounded private assets list")
    rels = private_manifest.get("relationships")
    if not isinstance(rels, list) or len(rels) > 10000:
        raise GT0Error("expected bounded YMAP relationship list")
    paths, nodes, hash_by_kind = set(), [], collections.defaultdict(list)
    for entry in assets:
        path = string_path(entry.get("originalPath"))
        if path in paths:
            raise GT0Error("duplicate source resource path")
        paths.add(path)
        kind = PurePosixPath(path).suffix.removeprefix(".")
        if kind not in ("ybn", "ymap", "ytyp", "ymf", "dat", "xml"):
            kind = "other"
        name = PurePosixPath(path).stem
        hash_id = joaat(name) if kind in ("ybn", "ymap") else None
        if kind in ("ybn", "ymap"):
            hash_by_kind[(kind, hash_id)].append(path)
        nodes.append({
            "sourceId": hashlib.sha256(path.encode()).hexdigest()[:20],
            "path": path, "kind": kind,
            "nameHash": hash_id, "contentSha256": entry.get("decodedPayloadSha256"),
            "archivePath": entry.get("topArchive"),
            "archiveSha256": None,  # filled by matching top-archive fingerprint
            "potentialVariant": True,
            "runtimeActiveStatus": "UNKNOWN",
        })
    archive_hashes = {}
    for arc in private_manifest.get("archives", []):
        path = string_path(arc.get("path"))
        archive_hashes[path] = arc.get("sha256")
    for node in nodes:
        arc = node["archivePath"]
        if arc:
            node["archiveSha256"] = archive_hashes.get(string_path(arc))
    edges, unresolved = [], []
    for rel in rels:
        ymap = string_path(rel.get("ymap"))
        if ymap not in paths:
            raise GT0Error("YMAP source relationship absent from selected asset manifest")
        parent = rel.get("parentHash")
        targets = []
        if type(parent) is int and parent != 0:
            targets.append(("YMAP_PARENT", "ymap", parent))
        for dictionary in rel.get("physicsDictionaryHashes", []):
            if type(dictionary) is not int:
                raise GT0Error("invalid physics dictionary reference")
            targets.append(("YMAP_PHYSICS_DICTIONARY", "ybn", dictionary))
        for archetype in rel.get("archetypeHashes", []):
            if type(archetype) is not int:
                raise GT0Error("invalid archetype reference")
            # The extraction manifest does not identify an archetype's YTYP
            # provider; its public source contains only a hash-closure count.
            edges.append({"from": ymap, "relation": "YMAP_ARCHETYPE_HASH",
                          "targetHash": archetype, "potentialTargets": [],
                          "resolution": "NEEDS_YTYP_ARCHETYPE_MAPPING"})
            unresolved.append({"source": ymap, "referenceType": "ARCHETYPE",
                               "targetHash": archetype})
        for rel_type, kind, hash_id in targets:
            matches = hash_by_kind.get((kind, hash_id), [])
            edges.append({"from": ymap, "relation": rel_type, "targetHash": hash_id,
                          "potentialTargets": matches,
                          "resolution": "RESOLVED_POTENTIAL" if matches else "UNRESOLVED"})
            if not matches:
                unresolved.append({"source": ymap, "referenceType": rel_type,
                                   "targetHash": hash_id})
    return {
        "graphSchemaVersion": 1,
        "visibility": "PRIVATE_LOCAL_ONLY",
        "sourceFormat": "EXTRACT_E0_ASSETS_MANIFEST_ONLY",
        "nodes": nodes, "edges": edges, "unresolved": unresolved,
        "summary": {
            "assetFiles": len(nodes), "ymapRelationships": len(rels),
            "unresolvedReferences": len(unresolved),
            "sourceVariantsMayOverlap": True,
            "activeCollisionPrecedenceVerified": False,
            "placedAndEmbeddedCollisionComplete": False,
        },
        "warning": "Links are references and candidate variants, not an active runtime collider graph. "
                   "No live winner is inferable without private placement, mod and GTA evidence.",
    }
