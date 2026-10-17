# Copyright (c) 2026-Present Datalayer, Inc.
#
# BSD 3-Clause License

"""A display says what it reads as, and each audience sees only its fields."""

from __future__ import annotations

from typing import Annotated

import pytest
from pydantic import SecretStr

from reactor import PluginManifest, PluginPlatform
from reactor.ui import (
    Display,
    DisplayRegistry,
    MemoryUiChannel,
    audience,
    display_type,
    model_view,
)
from reactor.ui import channel as ui
from reactor.ui.agui import encode_agui


@display_type("application/vnd.tests.weather+json", version=1)
class Weather(Display):
    city: str
    celsius: float
    note: Annotated[str, audience("page")] = ""
    api_key: SecretStr | None = None

    def text(self) -> str:
        return f"{self.city}: {self.celsius} °C"



def _patch(event):  # type: ignore[no-untyped-def]
    """An AG-UI delta's patch as JSON: ag-ui-protocol 1.x types the operations, 0.1 keeps dicts."""
    return event.model_dump(mode="json", by_alias=True, exclude_none=True)["patch"]

def test_the_wire_carries_the_fields_as_data_and_the_text() -> None:
    wire = Weather(id="w1", city="Brussels", celsius=12.5, note="bring a coat").wire()
    assert wire.type == "application/vnd.tests.weather+json"
    assert wire.version == 1
    assert wire.id == "w1"
    assert wire.text == "Brussels: 12.5 °C"
    assert wire.data == {"city": "Brussels", "celsius": 12.5, "note": "bring a coat"}


def test_the_model_sees_neither_page_fields_nor_secrets() -> None:
    weather = Weather(city="Ghent", celsius=9, note="for the person", api_key=SecretStr("s3cret"))
    view = weather.model_view()
    assert view == {
        "type": "application/vnd.tests.weather+json",
        "text": "Ghent: 9.0 °C",
        "data": {"city": "Ghent", "celsius": 9.0},
    }
    assert "s3cret" not in repr(view)


def test_a_secret_never_reaches_the_page_either() -> None:
    wire = Weather(city="Liège", celsius=3, api_key=SecretStr("s3cret")).wire()
    assert "api_key" not in wire.data


def test_model_view_applies_to_any_payload() -> None:
    from pydantic import BaseModel

    class Login(BaseModel):
        user: str
        password: SecretStr

    assert model_view(Login(user="ada", password=SecretStr("pw"))) == {"user": "ada"}


def test_a_display_without_text_is_refused() -> None:
    with pytest.raises(TypeError, match="text"):

        @display_type("application/vnd.tests.mute+json")
        class Mute(Display):
            pass


def test_a_display_type_is_a_media_type() -> None:
    with pytest.raises(ValueError, match="media type"):
        display_type("weather")


def test_a_taken_type_and_version_is_refused() -> None:
    registry = DisplayRegistry()
    registry.register(Weather)
    registry.register(Weather)  # the same class again is fine

    class Other(Display):
        display_type = Weather.display_type

        def text(self) -> str:
            return ""

    with pytest.raises(ValueError, match="already"):
        registry.register(Other)


def test_a_wire_display_parses_back_to_its_class() -> None:
    registry = DisplayRegistry()
    registry.register(Weather)
    parsed = registry.parse(Weather(id="w2", city="Namur", celsius=7).wire().model_dump())
    assert isinstance(parsed, Weather)
    assert (parsed.id, parsed.city) == ("w2", "Namur")
    with pytest.raises(LookupError):
        registry.parse({"type": "application/vnd.tests.unknown+json", "id": "x", "text": ""})


class WeatherPlugin:
    def provide_display_types(self, registry: DisplayRegistry) -> None:
        registry.register(Weather)


def test_plugins_provide_their_types_and_take_them_away() -> None:
    platform = PluginPlatform()
    platform.register_plugin(PluginManifest(name="weather", version="1.0.0"), WeatherPlugin())
    assert platform.display_types().types() == [("application/vnd.tests.weather+json", 1)]
    platform.disable_plugin("weather")
    assert platform.display_types().types() == []


def test_the_channel_keeps_ops_and_agui_encodes_them() -> None:
    channel = MemoryUiChannel()
    weather = Weather(id="w3", city="Mons", celsius=11)
    ui.show(channel, "s1", weather)
    ui.patch(channel, "s1", "w3", [{"op": "replace", "path": "/text", "value": "Mons: 12 °C"}])
    ui.append(channel, "s1", "w3", "/data/hours", 12)
    ui.state(channel, "s1", [{"op": "add", "path": "/unit", "value": "C"}])
    ui.meta(channel, "s1", title="Forecast")
    assert [op.op for op in channel.for_scope("s1")] == ["show", "patch", "append", "state", "meta"]
    assert channel.dump()[0]["body"]["data"]["city"] == "Mons"

    show, patch, append, state, meta = (encode_agui(op) for op in channel.ops)
    assert show.type == "ACTIVITY_SNAPSHOT" and show.message_id == "w3"
    assert show.content["display"]["text"] == "Mons: 11.0 °C"
    assert _patch(patch) == [{"op": "replace", "path": "/display/text", "value": "Mons: 12 °C"}]
    assert _patch(append) == [{"op": "add", "path": "/display/data/hours/-", "value": 12}]
    assert state.type == "STATE_DELTA"
    assert state.model_dump(mode="json", by_alias=True, exclude_none=True)["delta"] == [
        {"op": "add", "path": "/unit", "value": "C"}
    ]
    assert meta.type == "CUSTOM" and meta.name == "reactor.ui" and meta.value["body"] == {"title": "Forecast"}


def test_an_op_of_the_wrong_shape_is_refused() -> None:
    channel = MemoryUiChannel()
    with pytest.raises(ValueError):
        channel.emit({"v": 1, "op": "show", "scope": "s", "body": {"type": "x/y"}})
    with pytest.raises(ValueError):
        channel.emit({"v": 2, "op": "remove", "scope": "s", "id": "a"})


@display_type("application/vnd.tests.forecast+json", version=1)
class Forecast(Display):
    days: int

    def text(self) -> str:
        return f"{self.days} days"


class HalfwayPlugin:
    """Registers one type, then fails."""

    def provide_display_types(self, registry: DisplayRegistry) -> None:
        registry.register(Forecast)
        raise RuntimeError("halfway")


class OtherForecastPlugin:
    def provide_display_types(self, registry: DisplayRegistry) -> None:
        registry.register(OtherForecast)


class OtherForecast(Display):
    display_type = Forecast.display_type

    days: int

    def text(self) -> str:
        return "other"


def test_a_provider_that_fails_leaves_nothing_behind() -> None:
    platform = PluginPlatform()
    platform.register_plugin(PluginManifest(name="a-halfway", version="1.0.0"), HalfwayPlugin())
    platform.register_plugin(PluginManifest(name="b-other", version="1.0.0"), OtherForecastPlugin())
    registry = platform.display_types()
    assert registry.get(Forecast.display_type) is OtherForecast


def test_a_provider_whose_types_conflict_adds_none_of_them() -> None:
    class Both:
        def provide_display_types(self, registry: DisplayRegistry) -> None:
            registry.register(Weather)
            registry.register(OtherForecast)

    platform = PluginPlatform()
    platform.register_plugin(PluginManifest(name="a-forecast", version="1.0.0"), _Provides(Forecast))
    platform.register_plugin(PluginManifest(name="b-both", version="1.0.0"), Both())
    assert platform.display_types().types() == [(Forecast.display_type, 1)]


class _Provides:
    def __init__(self, cls: type[Display]) -> None:
        self.cls = cls

    def provide_display_types(self, registry: DisplayRegistry) -> None:
        registry.register(self.cls)


def test_agui_rebases_from_for_move_and_copy() -> None:
    channel = MemoryUiChannel()
    ui.patch(
        channel,
        "s1",
        "w3",
        [
            {"op": "move", "from": "/data/a", "path": "/data/b"},
            {"op": "copy", "from": "/data/b", "path": "/data/c"},
        ],
    )
    assert _patch(encode_agui(channel.ops[0])) == [
        {"op": "move", "from": "/display/data/a", "path": "/display/data/b"},
        {"op": "copy", "from": "/display/data/b", "path": "/display/data/c"},
    ]


@pytest.mark.parametrize(
    "operation",
    [
        {"op": "add", "path": "/a"},
        {"op": "replace", "path": "/a"},
        {"op": "test", "path": "/a"},
        {"op": "move", "path": "/a"},
        {"op": "copy", "path": "/a"},
        {"op": "remove", "path": "/a", "value": 1},
        {"op": "remove", "path": "/a", "from": "/b"},
    ],
)
def test_a_patch_operation_needs_exactly_its_fields(operation: dict) -> None:
    with pytest.raises(ValueError):
        ui.patch(MemoryUiChannel(), "s1", "w3", [operation])


def test_a_null_value_is_a_value() -> None:
    channel = MemoryUiChannel()
    ui.patch(channel, "s1", "w3", [{"op": "add", "path": "/a", "value": None}, {"op": "remove", "path": "/b"}])
    assert channel.dump()[0]["body"] == [{"op": "add", "path": "/a", "value": None}, {"op": "remove", "path": "/b"}]
