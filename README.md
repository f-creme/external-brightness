# External Display Brightness

A GNOME Shell extension to control the brightness of external
displays (not natively handled by GNOME, unlike a built-in laptop
screen), using the DDC/CI protocol.

## Features

- Panel menu listing every DDC/CI-capable external display, each with its own brightness slider
- "Control all screens" toggle to move every slider together
- Manual "Detect screens" button to (re)scan connected displays
- Displays a short notice when non-DDC/CI-capable screens (e.g. a laptop's own panel) are detected and skipped
- Available in English, French and German, following the system locale (falls back   to English otherwise)

## Requirements

- `ddcutil` (`sudo dnf install ddcutil` on Fedora)
- The `i2c-dev` kernel module loaded:
```bash
  sudo modprobe i2c-dev
  echo "i2c-dev" | sudo tee /etc/modules-load.d/i2c-dev.conf
```
- DDC/CI enabled in your monitor's own OSD menu 

## Installation

Clone this repository, then symlink it into GNOME's extensions
directory. The target folder name must match the `uuid` field in
`metadata.json` exactly — that's how GNOME Shell identifies the
extension:

```bash
git clone git@github.com:f-creme/external-brightness.git
ln -s "$(pwd)/external-brightness" ~/.local/share/gnome-shell/extensions/external-brightness@f-creme.github.io
```

You may have to log out and log back in, then enable it:

```bash
gnome-extensions enable external-brightness@f-creme.github.io
```

## Usage

Click the icon in the top panel, then "Detect screens" to list the
external displays currently connected. Drag a slider to adjust that
screen's brightness, or enable "Control all screens" to move every
detected display together.

## Development

Since GNOME Shell no longer supports hot-reloading extensions under
Wayland, use the isolated test session for development instead of
your main session:

```bash
dbus-run-session gnome-shell --devkit --wayland
```

(requires the `mutter-devkit` package)

## Translations

Translations use gettext. Source strings live in `po/`, compiled to `locale/<lang>/LC_MESSAGES/external-brightness@f-creme.github.io.mo` (required for translations to load, since this extension isn't packed via `gnome-extensions pack`).

To add or update a language, edit the relevant `.po` file, then recompile it:

```bash
msgfmt po/<lang>.po -o locale/<lang>/LC_MESSAGES/external-brightness@f-creme.github.io.mo
```