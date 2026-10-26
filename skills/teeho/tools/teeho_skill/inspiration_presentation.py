"""灵感索引沿用翻译字段、固定排版和已有参考笔记展示。"""

from collections.abc import Callable

from .messages import safe_text, safe_url
from .inspiration_contract import read_result, read_task

TEXTS = {
    "inspirationTitle": "Inspiration index",
    "inspirationThemes": "Themes in the reference notes",
    "inspirationAngles": "Angles to consider",
    "inspirationSaved": "Result saved locally.",
    "inspirationPending": "Searching and preparing your references. Continue the same task.",
    "inspirationWaitExpired": "The automatic waiting window ended. Check this task again later; do not submit it again.",
    "inspirationPartial": "Not enough references. No points charged.",
    "inspirationFailed": "Inspiration could not be completed. No points charged.",
    "inspirationExpired": "Result expired. Please submit your idea again. No points charged.",
    "inspirationSources": "Supporting references",
    "inspirationDeadline": "Receive before",
    "inspirationConfig": "Inspiration options are available in toolsData. Image notes cost 20 points; video notes cost 50 points for Coffee and Plus. Charges apply only after a complete result is saved and receipt confirmed.",
}


def inspiration_view(result: dict) -> dict:
    """结果就绪不伪装为已领取或真人已阅读。"""
    task = read_task(result.get("task"), result.get("task", {}).get("id"))
    status = task["status"]
    output = (
        read_result(result["result"], task)
        if result.get("result") is not None
        else None
    )
    state = (
        "completed"
        if result.get("saved") and status in ("received", "insufficient")
        else (
            "expired"
            if status == "expired"
            else "failed" if status == "failed" else "processing"
        )
    )
    message = (
        "inspirationSaved"
        if state == "completed"
        else (
            "inspirationExpired"
            if status == "expired"
            else "inspirationFailed" if status == "failed" else "inspirationPending"
        )
    )
    if status == "insufficient":
        message = "inspirationPartial"
    if result.get("waitExpired") is True:
        message = "inspirationWaitExpired"
    texts = {**TEXTS}
    layers = []
    if output:
        for name in ("themes", "angles"):
            items = []
            for index, item in enumerate(output[name]):
                key = f"inspiration_{name}_{index}"
                texts = {**texts, key: safe_text(item["text"])}
                sources = [
                    note["title"]
                    for note in output["notes"]
                    if note["noteId"] in item["references"]
                ]
                items = [*items, {"key": key, "sources": sources}]
            layers = [
                *layers,
                {
                    "title": (
                        "inspirationThemes" if name == "themes" else "inspirationAngles"
                    ),
                    "items": items,
                },
            ]
    notes = (
        []
        if not output
        else [
            {
                "title": safe_text(note["title"]),
                "excerpt": safe_text(note["bodyExcerpt"]),
                "url": safe_url(note["url"]),
                "topics": [],
                "modelScore": note["modelScore"],
                "likes": note["likes"],
                "collects": note["collects"],
                "comments": note["comments"],
                "selectionReason": "semantic_similarity",
            }
            for note in output["notes"]
        ]
    )
    return {
        "state": state,
        "kind": "inspiration",
        "nextAction": (
            "wait_for_user"
            if result.get("waitExpired") is True
            else "inspire-wait" if state == "processing" else None
        ),
        "texts": texts,
        "data": {
            "taskId": task["id"],
            "message": message,
            "layers": layers,
            "notes": notes,
            "expiresAt": task["expiresAt"],
            "charged": (
                task["pointCost"] if task["reservationStatus"] == "settled" else None
            ),
        },
    }


def inspiration_lines(
    view: dict, translate: Callable[[str], str], comparison_lines: Callable
) -> list[str]:
    """排版只使用已保存的服务端内容，不让宿主重新生成建议。"""
    data = view["data"]
    lines = ["🔥 " + translate("inspirationTitle"), "", translate(data["message"])]
    if data["charged"] is not None:
        lines = [*lines, translate("actualCharge") + ": " + str(data["charged"])]
    if view["state"] == "processing" and data.get("expiresAt"):
        lines = [*lines, translate("inspirationDeadline") + ": " + data["expiresAt"]]
    for layer in data["layers"]:
        if not layer["items"]:
            continue
        lines = [*lines, "", "【" + translate(layer["title"]) + "】"]
        for item in layer["items"]:
            lines = [
                *lines,
                "• " + translate(item["key"]),
                translate("inspirationSources") + ": " + " / ".join(item["sources"]),
            ]
    for note in data["notes"]:
        lines = [*lines, "", *comparison_lines(note, translate)]
    return lines
