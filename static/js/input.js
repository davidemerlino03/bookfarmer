class ScrcpyInput {
    constructor(callback, videoElement, width, height, debug = false) {
        this.callback = callback
        this.width = width
        this.height = height
        this.debug = debug
        let mouseX = null;
        let mouseY = null;
        let leftButtonIsPressed = false;
        let activePointerId = null;
        const textInputKeyUps = new Set();

        this.cancelTouch = () => {
            if (!leftButtonIsPressed) return;
            leftButtonIsPressed = false;
            activePointerId = null;
            if (mouseX !== null && mouseY !== null) {
                const data = this.createTouchProtocolData(1, mouseX, mouseY, this.width, this.height, 0, 0, 0);
                this.callback(data);
            }
        };

        const getPointerPosition = (event) => {
            const rect = videoElement.getBoundingClientRect();
            const elementWidth = rect.right - rect.left;
            const elementHeight = rect.bottom - rect.top;
            const deviceRatio = this.width / this.height;
            const elementRatio = elementWidth / elementHeight;
            let visualWidth = elementWidth;
            let visualHeight = elementHeight;
            let visualLeft = rect.left;
            let visualTop = rect.top;

            if (elementRatio > deviceRatio) {
                visualWidth = elementHeight * deviceRatio;
                visualLeft = rect.left + (elementWidth - visualWidth) / 2;
            } else {
                visualHeight = elementWidth / deviceRatio;
                visualTop = rect.top + (elementHeight - visualHeight) / 2;
            }

            const local_x = event.clientX - visualLeft;
            const local_y = event.clientY - visualTop;

            if (local_x < 0 || local_y < 0 || local_x > visualWidth || local_y > visualHeight) {
                return null;
            }

            return {
                x: Math.max(0, Math.min(this.width, (local_x / visualWidth) * this.width)),
                y: Math.max(0, Math.min(this.height, (local_y / visualHeight) * this.height))
            };
        };

        videoElement.addEventListener('pointerdown', (event) => {
            videoElement.focus();

            if (event.button === 2) {
                this.snedKeyCode(event, 0, 4);
                event.preventDefault();
                return;
            }

            if (event.button !== 0) return;

            const position = getPointerPosition(event);
            if (!position) return;

            leftButtonIsPressed = true;
            activePointerId = event.pointerId;
            videoElement.setPointerCapture(event.pointerId);
            mouseX = position.x;
            mouseY = position.y;

            let data = this.createTouchProtocolData(0, mouseX, mouseY, this.width, this.height, 0, 0, 65535);
            this.callback(data);
            event.preventDefault();
        });

        videoElement.addEventListener('pointerup', (event) => {
            if (event.button === 2) {
                this.snedKeyCode(event, 1, 4);
                event.preventDefault();
                return;
            }

            if (!leftButtonIsPressed || event.button !== 0) return;

            leftButtonIsPressed = false;
            activePointerId = null;
            if (videoElement.hasPointerCapture(event.pointerId)) {
                videoElement.releasePointerCapture(event.pointerId);
            }
            const position = getPointerPosition(event);
            if (position) {
                mouseX = position.x;
                mouseY = position.y;
            }

            let data = this.createTouchProtocolData(1, mouseX, mouseY, this.width, this.height, 0, 0, 0);
            this.callback(data);
            event.preventDefault();
        });

        videoElement.addEventListener('pointercancel', (event) => {
            if (!leftButtonIsPressed) return;
            leftButtonIsPressed = false;
            activePointerId = null;
            let data = this.createTouchProtocolData(1, mouseX, mouseY, this.width, this.height, 0, 0, 0);
            this.callback(data);
        });

        videoElement.addEventListener('pointermove', (event) => {
            if (!leftButtonIsPressed) return;
            if (activePointerId !== null && event.pointerId !== activePointerId) return;

            const position = getPointerPosition(event);
            if (position) {
                mouseX = position.x;
                mouseY = position.y;
            }

            let data = this.createTouchProtocolData(2, mouseX, mouseY, this.width, this.height, 0, 0, 65535);
            this.callback(data);
            event.preventDefault();
        });

        videoElement.addEventListener('contextmenu', (event) => {
            event.preventDefault();
        });

        const normalizeWheelDelta = (delta, deltaMode) => {
            const multiplier = deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : deltaMode === WheelEvent.DOM_DELTA_PAGE ? 120 : 1;
            const scaledDelta = delta * multiplier;
            if (!scaledDelta) return 0;
            return Math.max(-32767, Math.min(32767, Math.round(-scaledDelta)));
        };

        videoElement.addEventListener('wheel', (event) => {
            const position = getPointerPosition(event);
            if (!position) return;

            event.preventDefault();

            const hScroll = normalizeWheelDelta(event.deltaX, event.deltaMode);
            const vScroll = normalizeWheelDelta(event.deltaY, event.deltaMode);
            if (!hScroll && !vScroll) return;

            let data = this.createScrollProtocolData(
                position.x,
                position.y,
                this.width,
                this.height,
                hScroll,
                vScroll,
                event.button
            );
            this.callback(data);
        }, { passive: false });

        videoElement.addEventListener('keydown', async (event) => {
            if (this.sendTextInput(event)) {
                textInputKeyUps.add(event.code);
                event.preventDefault();
                return;
            }

            const androidKeyCode = this.mapToAndroidKeyCode(event);
            if (androidKeyCode !== null) {
                this.snedKeyCode(event, 0, androidKeyCode)
            } else {
                console.log(`key: ${event.code}, not mapped to android key code`);
            }

            if (event.ctrlKey && event.key === 'v') {
                try {
                    const clipboardData = await navigator.clipboard.readText();
                } catch (err) {
                    console.error('Failed to read clipboard contents: ', err);
                }
            }
        });

        videoElement.addEventListener('keyup', async (event) => {
            if (textInputKeyUps.has(event.code)) {
                textInputKeyUps.delete(event.code);
                event.preventDefault();
                return;
            }

            const androidKeyCode = this.mapToAndroidKeyCode(event);
            if (androidKeyCode !== null) {
                this.snedKeyCode(event, 1, androidKeyCode)
            } else {
                console.log(`key: ${event.code}, not mapped to android key code`);
            }
        });
    }

    resizeScreen(width, height) {
        this.width = width;
        this.height = height;
    }

    mapToAndroidKeyCode(event) {
        const codeToAndroidKeyCode = {
            'KeyA': 29,  // KEYCODE_A
            'KeyB': 30,  // KEYCODE_B
            'KeyC': 31,  // KEYCODE_C
            'KeyD': 32,  // KEYCODE_D
            'KeyE': 33,  // KEYCODE_E
            'KeyF': 34,  // KEYCODE_F
            'KeyG': 35,  // KEYCODE_G
            'KeyH': 36,  // KEYCODE_H
            'KeyI': 37,  // KEYCODE_I
            'KeyJ': 38,  // KEYCODE_J
            'KeyK': 39,  // KEYCODE_K
            'KeyL': 40,  // KEYCODE_L
            'KeyM': 41,  // KEYCODE_M
            'KeyN': 42,  // KEYCODE_N
            'KeyO': 43,  // KEYCODE_O
            'KeyP': 44,  // KEYCODE_P
            'KeyQ': 45,  // KEYCODE_Q
            'KeyR': 46,  // KEYCODE_R
            'KeyS': 47,  // KEYCODE_S
            'KeyT': 48,  // KEYCODE_T
            'KeyU': 49,  // KEYCODE_U
            'KeyV': 50,  // KEYCODE_V
            'KeyW': 51,  // KEYCODE_W
            'KeyX': 52,  // KEYCODE_X
            'KeyY': 53,  // KEYCODE_Y
            'KeyZ': 54,  // KEYCODE_Z

            'Digit0': 7,   // KEYCODE_0
            'Digit1': 8,   // KEYCODE_1
            'Digit2': 9,   // KEYCODE_2
            'Digit3': 10,  // KEYCODE_3
            'Digit4': 11,  // KEYCODE_4
            'Digit5': 12,  // KEYCODE_5
            'Digit6': 13,  // KEYCODE_6
            'Digit7': 14,  // KEYCODE_7
            'Digit8': 15,  // KEYCODE_8
            'Digit9': 16,  // KEYCODE_9

            'Enter': 66,       // KEYCODE_ENTER
            'Backspace': 67,   // KEYCODE_DEL
            'Tab': 61,         // KEYCODE_TAB
            'Space': 62,       // KEYCODE_SPACE
            'Escape': 111,     // KEYCODE_ESCAPE
            'Insert': 124,      // KEYCODE_INSERT
            'Delete': 112,      // KEYCODE_FORWARD_DEL
            'PageUp': 92,       // KEYCODE_PAGE_UP
            'PageDown': 93,     // KEYCODE_PAGE_DOWN
            'End': 123,         // KEYCODE_MOVE_END
            'PrintScreen': 120, // KEYCODE_SYSRQ
            'Pause': 121,       // KEYCODE_BREAK
            'CapsLock': 115,   // KEYCODE_CAPS_LOCK
            'NumLock': 143,    // KEYCODE_NUM_LOCK
            'ScrollLock': 116, // KEYCODE_SCROLL_LOCK

            'ArrowUp': 19,     // KEYCODE_DPAD_UP
            'ArrowDown': 20,   // KEYCODE_DPAD_DOWN
            'ArrowLeft': 21,   // KEYCODE_DPAD_LEFT
            'ArrowRight': 22,  // KEYCODE_DPAD_RIGHT

            'ShiftLeft': 59,   // KEYCODE_SHIFT_LEFT
            'ShiftRight': 60,  // KEYCODE_SHIFT_RIGHT
            'ControlLeft': 113,// KEYCODE_CTRL_LEFT
            'ControlRight': 114,// KEYCODE_CTRL_RIGHT
            'AltLeft': 57,     // KEYCODE_ALT_LEFT
            'AltRight': 58,    // KEYCODE_ALT_RIGHT
            'MetaLeft': 117,   // KEYCODE_META_LEFT
            'MetaRight': 118,  // KEYCODE_META_RIGHT
            'ContextMenu': 82,  // KEYCODE_MENU

            'Backquote': 68,    // KEYCODE_GRAVE
            'Minus': 69,        // KEYCODE_MINUS
            'Equal': 70,        // KEYCODE_EQUALS
            'BracketLeft': 71,  // KEYCODE_LEFT_BRACKET
            'BracketRight': 72, // KEYCODE_RIGHT_BRACKET
            'Backslash': 73,    // KEYCODE_BACKSLASH
            'Semicolon': 74,    // KEYCODE_SEMICOLON
            'Quote': 75,        // KEYCODE_APOSTROPHE
            'Comma': 55,        // KEYCODE_COMMA
            'Period': 56,       // KEYCODE_PERIOD
            'Slash': 76,        // KEYCODE_SLASH

            'Numpad0': 144,    // KEYCODE_NUMPAD_0
            'Numpad1': 145,    // KEYCODE_NUMPAD_1
            'Numpad2': 146,    // KEYCODE_NUMPAD_2
            'Numpad3': 147,    // KEYCODE_NUMPAD_3
            'Numpad4': 148,    // KEYCODE_NUMPAD_4
            'Numpad5': 149,    // KEYCODE_NUMPAD_5
            'Numpad6': 150,    // KEYCODE_NUMPAD_6
            'Numpad7': 151,    // KEYCODE_NUMPAD_7
            'Numpad8': 152,    // KEYCODE_NUMPAD_8
            'Numpad9': 153,    // KEYCODE_NUMPAD_9
            'NumpadEnter': 160,// KEYCODE_NUMPAD_ENTER
            'NumpadAdd': 157,  // KEYCODE_NUMPAD_ADD
            'NumpadSubtract': 156, // KEYCODE_NUMPAD_SUBTRACT
            'NumpadMultiply': 155, // KEYCODE_NUMPAD_MULTIPLY
            'NumpadDivide': 154,   // KEYCODE_NUMPAD_DIVIDE
            'NumpadDecimal': 158,  // KEYCODE_NUMPAD_DOT
            'NumpadComma': 159,    // KEYCODE_NUMPAD_COMMA
            'NumpadEqual': 161,    // KEYCODE_NUMPAD_EQUALS
            'NumpadParenLeft': 162, // KEYCODE_NUMPAD_LEFT_PAREN
            'NumpadParenRight': 163, // KEYCODE_NUMPAD_RIGHT_PAREN

            'F1': 131,  // KEYCODE_F1
            'F2': 132,  // KEYCODE_F2
            'F3': 133,  // KEYCODE_F3
            'F4': 134,  // KEYCODE_F4
            'F5': 135,  // KEYCODE_F5
            'F6': 136,  // KEYCODE_F6
            'F7': 137,  // KEYCODE_F7
            'F8': 138,  // KEYCODE_F8
            'F9': 139,  // KEYCODE_F9
            'F10': 140, // KEYCODE_F10
            'F11': 141, // KEYCODE_F11
            'F12': 142, // KEYCODE_F12

            'AudioVolumeUp': 24,       // KEYCODE_VOLUME_UP
            'AudioVolumeDown': 25,     // KEYCODE_VOLUME_DOWN
            'AudioVolumeMute': 164,    // KEYCODE_VOLUME_MUTE
            'MediaPlayPause': 85,      // KEYCODE_MEDIA_PLAY_PAUSE
            'MediaStop': 86,           // KEYCODE_MEDIA_STOP
            'MediaTrackNext': 87,      // KEYCODE_MEDIA_NEXT
            'MediaTrackPrevious': 88,  // KEYCODE_MEDIA_PREVIOUS
            'MediaRewind': 89,         // KEYCODE_MEDIA_REWIND
            'MediaFastForward': 90,    // KEYCODE_MEDIA_FAST_FORWARD
            'MediaRecord': 130,        // KEYCODE_MEDIA_RECORD
            'Eject': 129,              // KEYCODE_MEDIA_EJECT

            'BrowserSearch': 84,   // KEYCODE_SEARCH
            'BrowserBack': 4,      // KEYCODE_BACK
            'BrowserForward': 125, // KEYCODE_FORWARD
            'BrowserHome': 3,      // KEYCODE_HOME
            'Power': 26,           // KEYCODE_POWER
            'WakeUp': 224,         // KEYCODE_WAKEUP
            'Sleep': 223,          // KEYCODE_SLEEP

            'Back': 4,    // KEYCODE_BACK
            'Home': 3,    // KEYCODE_HOME
            'Menu': 82,   // KEYCODE_MENU
        };

        const androidKeyCode = codeToAndroidKeyCode[event.code];
        return androidKeyCode !== undefined ? androidKeyCode : null;
    }

    sendTextInput(event) {
        if (!this.isTextInputEvent(event)) {
            return false;
        }

        this.callback(this.createTextProtocolData(event.key));
        return true;
    }

    isTextInputEvent(event) {
        if (event.metaKey) {
            return false;
        }

        if (event.ctrlKey && !event.altKey) {
            return false;
        }

        if (!event.key || event.key === 'Dead') {
            return false;
        }

        return Array.from(event.key).length === 1;
    }

    snedKeyCode(keyevent, action, keycode) {
        const capsLockState = keyevent.getModifierState('CapsLock');
        const numLockState = keyevent.getModifierState('NumLock');
        const scrollLockState = keyevent.getModifierState('ScrollLock');

        let metakey = 0;
        if (keyevent.shiftKey) {
            metakey |= 0x40;
        }
        if (keyevent.ctrlKey) {
            metakey |= 0x2000;
        }
        if (keyevent.altKey) {
            metakey |= 0x10;
        }
        if (keyevent.metaKey) {
            metakey |= 0x20000;
        }
        if (capsLockState) {
            metakey |= 0x100000;
        }
        if (numLockState) {
            metakey |= 0x200000;
        }
        // if(scrollLockState)
        // {
        //     metakey |= 0x400000;
        // }
        let data = this.createKeyProtocolData(action, keycode, keyevent.repeat, metakey);
        this.callback(data);
    }

    createTextProtocolData(text) {
        const type = 1; // text event
        const encoder = new TextEncoder();
        const textBytes = encoder.encode(text);
        const buffer = new ArrayBuffer(1 + 4 + textBytes.length);
        const view = new DataView(buffer);
        const bytes = new Uint8Array(buffer);

        let offset = 0;
        view.setUint8(offset, type);
        offset += 1;

        view.setUint32(offset, textBytes.length, false);
        offset += 4;

        bytes.set(textBytes, offset);
        return buffer;
    }

    createTouchProtocolData(action, x, y, width, height, actionButton, buttons, pressure) {
        const type = 2; // touch event

        const buffer = new ArrayBuffer(1 + 1 + 8 + 4 + 4 + 2 + 2 + 2 + 4 + 4);
        const view = new DataView(buffer);

        let offset = 0;

        view.setUint8(offset, type);
        offset += 1;

        view.setUint8(offset, action);
        offset += 1;

        view.setUint8(offset, 0xff);
        offset += 1;
        view.setUint8(offset, 0xff);
        offset += 1;
        view.setUint8(offset, 0xff);
        offset += 1;
        view.setUint8(offset, 0xff);
        offset += 1;
        view.setUint8(offset, 0xff);
        offset += 1;
        view.setUint8(offset, 0xff);
        offset += 1;
        view.setUint8(offset, 0xff);
        offset += 1;
        view.setUint8(offset, 0xfd);
        offset += 1;

        view.setInt32(offset, x, false);
        offset += 4;
        view.setInt32(offset, y, false);
        offset += 4;
        view.setUint16(offset, width, false);
        offset += 2;
        view.setUint16(offset, height, false);
        offset += 2;

        view.setInt16(offset, pressure, false);
        offset += 2;

        view.setInt32(offset, actionButton, false);
        offset += 4;

        view.setInt32(offset, buttons, false);

        return buffer;
    }

    createKeyProtocolData(action, keycode, repeat, metaState) {
        const type = 0; // key event

        const buffer = new ArrayBuffer(1 + 1 + 4 + 4 + 4);
        const view = new DataView(buffer);

        let offset = 0;

        view.setUint8(offset, type);
        offset += 1;

        view.setUint8(offset, action);
        offset += 1;

        view.setInt32(offset, keycode, false);
        offset += 4;
        view.setInt32(offset, repeat, false);
        offset += 4;
        view.setInt32(offset, metaState, false);

        return buffer;
    }

    createScrollProtocolData(x, y, width, height, hScroll, vScroll, button) {
        const type = 3; // scroll event

        const buffer = new ArrayBuffer(1 + 4 + 4 + 2 + 2 + 2 + 2 + 4);
        const view = new DataView(buffer);

        let offset = 0;
        view.setUint8(offset, type);
        offset += 1;

        view.setInt32(offset, x, false);
        offset += 4;
        view.setInt32(offset, y, false);
        offset += 4;
        view.setUint16(offset, width, false);
        offset += 2;
        view.setUint16(offset, height, false);
        offset += 2;

        view.setInt16(offset, hScroll, false);
        offset += 2;
        view.setInt16(offset, vScroll, false);
        offset += 2;

        view.setInt32(offset, button, false);

        return buffer;
    }

    createScreenProtocolData(action) {
        const type = 4; // Screen off/on event

        const buffer = new ArrayBuffer(1 + 1);
        const view = new DataView(buffer);

        let offset = 0;
        view.setUint8(offset, type);
        offset += 1;

        view.setUint8(offset, action);

        return buffer;
    }

    createPowerProtocolData(action) {
        const type = 7; // Screen Power off/on event

        const buffer = new ArrayBuffer(1 + 1);
        const view = new DataView(buffer);

        let offset = 0;
        view.setUint8(offset, type);
        offset += 1;

        view.setUint8(offset, action);

        return buffer;
    }

    add_debug_item(text) {
        const p = document.createElement('p');
        p.textContent = text;
        const span = document.createElement('span');
        span.textContent = '0';
        p.appendChild(span);
        document.body.appendChild(p);
        return span;
    }

    screen_on_off(action) {
        let data = null;
        data = this.createScreenProtocolData(action);
        this.callback(data)
    }
}
