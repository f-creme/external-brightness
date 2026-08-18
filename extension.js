import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import St from 'gi://St';
import Gio from 'gi://Gio';
import Clutter from 'gi://Clutter';

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Slider from 'resource:///org/gnome/shell/ui/slider.js';

const DEBOUNCE_MS = 200;

const BrightnessIndicator = GObject.registerClass(
class BrightnessIndicator extends PanelMenu.Button {
    _init() {
        super._init(0.5, 'External Display Brightness', false);

        this._debounceIds = new Map();
        this._displayRows = new Map();
        this._controlAllSwitch = null;

        this._syncingSliders = false;

        let icon = new St.Icon({
            icon_name: 'display-brightness-symbolic',
            style_class: 'system-status-icon',
        });
        this.add_child(icon);

        this.menu.box.add_style_class_name('external-brightness-menu');

        this._buildStaticMenu();
    }

    _buildStaticMenu() {
        this._titleItem = new PopupMenu.PopupMenuItem('External Display Brightness', {
            reactive: false,
            can_focus: false,
        });
        this._titleItem.label.add_style_class_name('external-brightness-title');
        this.menu.addMenuItem(this._titleItem);

        this._displaysSeparator = new PopupMenu.PopupSeparatorMenuItem();
        this.menu.addMenuItem(this._displaysSeparator);

        this._controlAllSwitch = new PopupMenu.PopupSwitchMenuItem('Control all screens', false);
        this.menu.addMenuItem(this._controlAllSwitch);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        let detectItem = new PopupMenu.PopupBaseMenuItem({ activate: false });
        let detectIcon = new St.Icon({
            icon_name: 'video-display-symbolic',
            style_class: 'external-brightness-row-icon',
        });
        let detectLabel = new St.Label({
            text: 'Detect screens',
            y_align: Clutter.ActorAlign.CENTER,
        });
        detectItem.add_child(detectIcon);
        detectItem.add_child(detectLabel);
        detectItem.connect('button-release-event', () => this._onDetectClicked());
        this.menu.addMenuItem(detectItem);

        this._infoItem = new PopupMenu.PopupMenuItem('', {
            reactive: false,
            can_focus: false,
        });
        this._infoItem.label.add_style_class_name('external-brightness-info');
        this._infoItem.visible = false;
        this.menu.addMenuItem(this._infoItem);
    }

    _onDetectClicked() {
        this._detectDisplays();
        return Clutter.EVENT_STOP;
    }

    _clearDisplayRows() {
        for (const row of this._displayRows.values()) {
            row.item.destroy();
        }
        this._displayRows.clear();
    }

    _detectDisplays() {
        try {
            let proc = Gio.Subprocess.new(
                ['ddcutil', 'detect', '--brief'],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
            );
            proc.communicate_utf8_async(null, null, (p, res) => {
                try {
                    let [, stdout] = p.communicate_utf8_finish(res);
                    let { displays, invalidCount } = this._parseDetectOutput(stdout);
                    this._disambiguateNames(displays);
                    this._clearDisplayRows();
                    for (const display of displays) {
                        this._addDisplayRow(display);
                    }
                    this._updateInfoMessage(invalidCount);
                } catch (e) {
                    console.error(`External Brightness: erreur détection = ${e}`);
                }
            });
        } catch (e) {
            console.error(`External Brightness: échec lancement detect = ${e}`);
        }
    }

    _parseDetectOutput(output) {
        let displays = [];
        let invalidCount = 0;
        let current = null;

        for (const line of output.split('\n')) {

            if (/^Invalid display/.test(line)) {
                if (current && current.bus !== null)
                    displays.push(current);
                current = null;
                invalidCount++;
                continue;
            }

            let dispMatch = line.match(/^Display\s+(\d+)/);
            if (dispMatch) {
                if (current && current.bus !== null)
                    displays.push(current);
                current = { bus: null, name: `Écran ${dispMatch[1]}` };
                continue;
            }
            if (!current) continue;

            let busMatch = line.match(/\/dev\/i2c-(\d+)/);
            if (busMatch) current.bus = parseInt(busMatch[1], 10);

            let monMatch = line.match(/Monitor:\s*([^\n]+)/);
            if (monMatch) {
                let parts = monMatch[1].split(':').map(s => s.trim());
                if (parts.length >= 2 && parts[1])
                    current.name = parts[1];
            }
        }
        if (current && current.bus !== null)
            displays.push(current);

        return { displays, invalidCount };
    }

    _updateInfoMessage(invalidCount) {
        if (invalidCount > 0) {
            this._infoItem.label.text = invalidCount === 1
                ? '1 display ignored (not DDC/CI compatible)'
                : `${invalidCount} displays ignored (not DDC/CI compatible)`;
            this._infoItem.visible = true;
        } else {
            this._infoItem.visible = false;
        }
    }

    _disambiguateNames(displays) {
        let counts = new Map();
        for (const d of displays)
            counts.set(d.name, (counts.get(d.name) ?? 0) + 1);

        for (const d of displays) {
            if (counts.get(d.name) > 1)
                d.name = `${d.name} (bus ${d.bus})`;
        }
    }

    _addDisplayRow(display) {
        let item = new PopupMenu.PopupBaseMenuItem({ activate: false });
        let box = new St.BoxLayout({ vertical: true, x_expand: true });

        let label = new St.Label({
            text: display.name,
            style_class: 'external-brightness-label',
        });

        let row = new St.BoxLayout({ vertical: false, x_expand: true });
        let rowIcon = new St.Icon({
            icon_name: 'display-brightness-symbolic',
            style_class: 'external-brightness-row-icon',
        });
        let slider = new Slider.Slider(0.5);
        slider.x_expand = true;

        row.add_child(rowIcon);
        row.add_child(slider);

        box.add_child(label);
        box.add_child(row);
        item.add_child(box);

        this.menu.addMenuItem(item, 1 + this._displayRows.size);

        slider.connect('notify::value', () => {
            if (this._syncingSliders) return;
            this._onSliderChanged(display.bus, slider.value);
        });

        this._displayRows.set(display.bus, { name: display.name, slider, item });

        this._readBrightness(display.bus);
    }

    _readBrightness(bus) {
        try {
            let proc = Gio.Subprocess.new(
                ['ddcutil', 'getvcp', '10', '--bus', String(bus)],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
            );
            proc.communicate_utf8_async(null, null, (p, res) => {
                try {
                    let [, stdout] = p.communicate_utf8_finish(res);
                    if (!p.get_successful()) return;

                    let match = stdout.match(/current value\s*=\s*(\d+),\s*max value\s*=\s*(\d+)/);
                    if (!match) return;

                    let row = this._displayRows.get(bus);
                    if (!row) return; 

                    let ratio = parseInt(match[1], 10) / parseInt(match[2], 10);

                    this._syncingSliders = true;
                    row.slider.value = ratio;
                    this._syncingSliders = false;
                } catch (e) {
                    console.error(`External Brightness: erreur lecture bus ${bus} = ${e}`);
                }
            });
        } catch (e) {
            console.error(`External Brightness: échec lancement getvcp = ${e}`);
        }
    }

    _onSliderChanged(sourceBus, value) {
        if (this._controlAllSwitch.state) {
            this._syncingSliders = true;
            for (const [bus, row] of this._displayRows) {
                if (bus !== sourceBus) row.slider.value = value;
                this._scheduleSetBrightness(bus, value);
            }
            this._syncingSliders = false;
        } else {
            this._scheduleSetBrightness(sourceBus, value);
        }
    }

    _scheduleSetBrightness(bus, value) {
        if (this._debounceIds.has(bus)) {
            GLib.source_remove(this._debounceIds.get(bus));
        }

        let id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, DEBOUNCE_MS, () => {
            this._debounceIds.delete(bus);
            this._setBrightness(bus, value);
            return GLib.SOURCE_REMOVE;
        });
        this._debounceIds.set(bus, id);
    }

    _setBrightness(bus, value) {
        let percent = Math.round(value * 100);

        try {
            let proc = Gio.Subprocess.new(
                ['ddcutil', 'setvcp', '10', String(percent), '--bus', String(bus)],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
            );
            proc.communicate_utf8_async(null, null, (p, res) => {
                try {
                    let [, , stderr] = p.communicate_utf8_finish(res);
                    if (!p.get_successful()) {
                        console.error(`External Brightness: ddcutil (bus ${bus}) a échoué: ${stderr.trim()}`);
                        return;
                    }
                    console.log(`External Brightness: bus ${bus} réglé à ${percent}%`);
                } catch (e) {
                    console.error(`External Brightness: erreur = ${e}`);
                }
            });
        } catch (e) {
            console.error(`External Brightness: échec lancement = ${e}`);
        }
    }

    destroy() {
        for (const id of this._debounceIds.values()) {
            GLib.source_remove(id);
        }
        this._debounceIds.clear();
        super.destroy();
    }
});

export default class ExternalBrightnessExtension extends Extension {
    enable() {
        this._indicator = new BrightnessIndicator();
        Main.panel.addToStatusArea(this.uuid, this._indicator);
    }

    disable() {
        this._indicator.destroy();
        this._indicator = null;
    }
}