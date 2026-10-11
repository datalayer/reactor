# Copyright (c) 2026-Present Datalayer, Inc.
#
# Datalayer License

"""Only what a display offered can be pressed, and any plugin may say no."""

from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient
from pydantic import BaseModel

from reactor import PluginManifest, PluginPlatform
from reactor.ui import (
    ActionRegistry,
    UiAction,
    UiActionError,
    UiActionPayloadInvalid,
    UiActionRefused,
    UiActionTokenInvalid,
    UnknownUiAction,
)

SECRET = b"0123456789abcdef0123456789abcdef"


class Refresh(BaseModel):
    city: str


def make(platform: PluginPlatform | None = None) -> tuple[ActionRegistry, list[tuple[str, str]]]:
    calls: list[tuple[str, str]] = []

    def refresh(payload: Refresh, context) -> dict:
        calls.append((payload.city, context.display_id))
        return {"refreshed": payload.city}

    actions = ActionRegistry(SECRET, platform=platform)
    actions.register("weather.refresh", Refresh, refresh, plugin="weather")
    return actions, calls


def press(actions: ActionRegistry, session: str = "s1", display: str = "w1", **extra) -> UiAction:
    offer = actions.offer(session, display, "weather.refresh", label="Refresh")
    return UiAction(
        action="weather.refresh", display_id=display, token=offer.token, payload={"city": "Ghent"}, **extra
    )


async def test_an_offered_action_runs() -> None:
    actions, calls = make()
    assert await actions.dispatch("ada", "s1", press(actions)) == {"refreshed": "Ghent"}
    assert calls == [("Ghent", "w1")]


async def test_a_token_is_bound_to_session_display_and_action() -> None:
    actions, calls = make()
    offered = press(actions, session="s1", display="w1")
    with pytest.raises(UiActionTokenInvalid):
        await actions.dispatch("ada", "s2", offered)
    with pytest.raises(UiActionTokenInvalid):
        await actions.dispatch("ada", "s1", offered.model_copy(update={"display_id": "w2"}))
    with pytest.raises(UiActionTokenInvalid):
        await actions.dispatch("ada", "s1", offered.model_copy(update={"token": "forged"}))
    assert calls == []


async def test_an_unknown_action_is_a_422_and_never_runs() -> None:
    actions, _ = make()
    with pytest.raises(UnknownUiAction) as raised:
        await actions.dispatch("ada", "s1", UiAction(action="weather.nope", display_id="w1", token="t"))
    assert raised.value.status_code == 422
    with pytest.raises(UnknownUiAction):
        actions.offer("s1", "w1", "weather.nope")


async def test_a_payload_that_does_not_validate_is_a_422() -> None:
    actions, calls = make()
    with pytest.raises(UiActionPayloadInvalid) as raised:
        await actions.dispatch("ada", "s1", press(actions).model_copy(update={"payload": {"town": 1}}))
    assert raised.value.status_code == 422
    assert calls == []


class Allow:
    def authorize_ui_action(self, principal, session, action) -> bool:
        return True


class Deny:
    def authorize_ui_action(self, principal, session, action) -> bool:
        return not (principal == "eve" and action.action == "weather.refresh")


class Broken:
    def authorize_ui_action(self, principal, session, action) -> bool:
        raise RuntimeError("cannot decide")


async def test_any_plugin_may_veto() -> None:
    platform = PluginPlatform()
    platform.register_plugin(PluginManifest(name="allow", version="1.0.0"), Allow())
    platform.register_plugin(PluginManifest(name="deny", version="1.0.0"), Deny())
    actions, calls = make(platform)
    assert await actions.dispatch("ada", "s1", press(actions)) == {"refreshed": "Ghent"}
    with pytest.raises(UiActionRefused) as raised:
        await actions.dispatch("eve", "s1", press(actions))
    assert raised.value.status_code == 403
    assert calls == [("Ghent", "w1")]

    platform.disable_plugin("deny")
    assert await actions.dispatch("eve", "s1", press(actions)) == {"refreshed": "Ghent"}


async def test_a_hook_that_raises_vetoes() -> None:
    platform = PluginPlatform()
    platform.register_plugin(PluginManifest(name="broken", version="1.0.0"), Broken())
    actions, calls = make(platform)
    with pytest.raises(UiActionRefused):
        await actions.dispatch("ada", "s1", press(actions))
    assert calls == []


async def test_a_repeated_idempotency_id_runs_once() -> None:
    actions, calls = make()
    first = await actions.dispatch("ada", "s1", press(actions, idempotency_id="k1"))
    again = await actions.dispatch("ada", "s1", press(actions, idempotency_id="k1"))
    other = await actions.dispatch("ada", "s1", press(actions, idempotency_id="k2"))
    assert first == again == other
    assert len(calls) == 2


async def test_a_failed_press_is_forgotten_so_a_retry_runs() -> None:
    attempts: list[int] = []

    async def flaky(payload: Refresh, context) -> str:
        attempts.append(1)
        if len(attempts) == 1:
            raise RuntimeError("try again")
        return "ok"

    actions = ActionRegistry(SECRET)
    actions.register("weather.refresh", Refresh, flaky, plugin="weather")
    with pytest.raises(RuntimeError):
        await actions.dispatch("ada", "s1", press(actions, idempotency_id="k"))
    assert await actions.dispatch("ada", "s1", press(actions, idempotency_id="k")) == "ok"


def test_a_route_answers_with_the_status_the_error_carries() -> None:
    actions, _ = make()
    app = FastAPI()

    @app.exception_handler(UiActionError)
    async def refused(request, error: UiActionError) -> JSONResponse:
        return JSONResponse({"detail": str(error)}, status_code=error.status_code)

    @app.post("/sessions/{session}/actions")
    async def act(session: str, body: UiAction) -> dict:
        return {"result": await actions.dispatch(None, session, body)}

    client = TestClient(app)
    ok = client.post("/sessions/s1/actions", json=press(actions).model_dump())
    assert ok.status_code == 200 and ok.json() == {"result": {"refreshed": "Ghent"}}
    unknown = client.post(
        "/sessions/s1/actions", json={"action": "weather.nope", "display_id": "w1", "token": "t"}
    )
    assert unknown.status_code == 422
    assert "weather.nope" in unknown.json()["detail"]


def test_two_plugins_cannot_register_one_name_and_unregistering_takes_theirs() -> None:
    actions, _ = make()
    with pytest.raises(ValueError, match="already registered"):
        actions.register("weather.refresh", Refresh, lambda p, c: None, plugin="other")
    actions.unregister_plugin("weather")
    assert actions.names() == []
