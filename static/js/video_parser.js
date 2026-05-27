class VideoParser {
    constructor(onNaluCallback, debug = false) {
        this.debug = debug
        this.buffer = new Uint8Array(0);
        this.name = null;
        this.codecId = null;
        this.width = null;
        this.height = null;
        this.hasKeyFrame = null;
        this.sps = null;
        this.pps = null;
        this.mimeCodec = null;
        this.onNaluCallback = onNaluCallback;
        this.hasSentSpsPps = false;
    }

    static get CODEC_IDS() {
        return new Map([
            [0x68323634, 'h264'],
            [0x68323635, 'h265'],
            [0x00617631, 'av1']
        ]);
    }

    isValidSize(width, height) {
        return Number.isInteger(width) &&
            Number.isInteger(height) &&
            width > 0 &&
            height > 0 &&
            width <= 10000 &&
            height <= 10000;
    }

    readUint32(offset) {
        return new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength).getUint32(offset, false);
    }

    sendSize(width, height) {
        this.width = width;
        this.height = height;
        console.log("width:" + this.width + " height:" + this.height);
        if (this.onNaluCallback) {
            this.onNaluCallback({
                type: 'screen_size',
                data: { "width": this.width, "height": this.height }
            });
        }
    }

    appendData(data) {
        const newBuffer = new Uint8Array(this.buffer.length + data.length);
        newBuffer.set(this.buffer, 0);
        newBuffer.set(data, this.buffer.length);
        this.buffer = newBuffer;
        this.scrcpyProcessBuffer();
    }

    scrcpyProcessBuffer() {
        let startIndex = 0;
        while (true) {
            if (this.name == null) {
                if (this.buffer.length < 4) {
                    break;
                }

                const maybeCodecId = this.readUint32(0);
                if (VideoParser.CODEC_IDS.has(maybeCodecId)) {
                    this.name = '';
                    continue;
                }

                if (this.buffer.length < 64) {
                    break;
                }

                const name = this.buffer.slice(0, 64);
                this.name = new TextDecoder().decode(name).replace(/\0+$/g, '');
                console.log("Device name:" + this.name);
                if (this.onNaluCallback) {
                    this.onNaluCallback({
                        type: 'name',
                        data: { "name": this.name }
                    });
                }
                startIndex = 64;
                break;
            } else if (this.codecId == null) {
                if (this.buffer.length < 4) {
                    break;
                }

                const codecId = this.readUint32(0);
                if (!VideoParser.CODEC_IDS.has(codecId)) {
                    console.warn("Unknown video codec id", codecId.toString(16));
                    break;
                }

                this.codecId = VideoParser.CODEC_IDS.get(codecId);
                console.log("Video codec:" + this.codecId);
                startIndex = 4;
                break;
            } else if (this.width == null) {
                if (this.buffer.length < 8) {
                    break;
                }

                const firstByte = this.buffer[0];
                if ((firstByte & 0x80) !== 0) {
                    if (this.buffer.length < 12) {
                        break;
                    }
                    const width = this.readUint32(4);
                    const height = this.readUint32(8);
                    if (!this.isValidSize(width, height)) {
                        console.warn("Ignoring invalid scrcpy session size", width, height);
                        break;
                    }
                    this.sendSize(width, height);
                    startIndex = 12;
                } else if (VideoParser.CODEC_IDS.has(this.readUint32(0))) {
                    const width = this.readUint32(4);
                    const height = this.readUint32(8);
                    if (!this.isValidSize(width, height)) {
                        console.warn("Ignoring invalid scrcpy stream size", width, height);
                        break;
                    }
                    this.codecId = VideoParser.CODEC_IDS.get(this.readUint32(0));
                    this.sendSize(width, height);
                    startIndex = 12;
                } else {
                    const width = this.readUint32(0);
                    const height = this.readUint32(4);
                    if (!this.isValidSize(width, height)) {
                        break;
                    }
                    this.sendSize(width, height);
                    startIndex = 8;
                }
                break;
            } else {
                break;
            }
        }

        if (startIndex > 0 && this.width == null) {
            this.buffer = this.buffer.slice(startIndex);
            this.scrcpyProcessBuffer();
            return;
        }

        while (this.width != null && this.buffer.length - startIndex > 12) {
            const firstByte = this.buffer[startIndex];

            if ((firstByte & 0x80) !== 0 && (firstByte & 0x40) === 0) {
                const width = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength).getUint32(startIndex + 4, false);
                const height = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength).getUint32(startIndex + 8, false);
                if (this.isValidSize(width, height)) {
                    this.sendSize(width, height);
                    startIndex += 12;
                    continue;
                }
            }

            const size = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength).getUint32(startIndex + 8, false);
            if (size > 0 && this.buffer.length - startIndex >= 12 + size) {
                const nalu = this.buffer.slice(startIndex + 12, startIndex + 12 + size);
                this.processBuffer(nalu)
                startIndex = startIndex + 12 + size;
            } else {
                break;
            }
        }
        this.buffer = this.buffer.slice(startIndex);
    }

    findSequence(arr, sequence, startIndex = 0) {
        const seqLength = sequence.length;
        for (let i = startIndex; i <= arr.length - seqLength; i++) {
            let match = true;
            for (let j = 0; j < seqLength; j++) {
                if (arr[i + j] !== sequence[j]) {
                    match = false;
                    break;
                }
            }
            if (match) {
                return i;
            }
        }
        return -1;
    }

    processBuffer(nalu) {
        const nalu_type = nalu[4] & 0x1f;
        if (nalu_type === 1) {
            if (this.debug)
                console.log("P frame", nalu.length)
        } else if (nalu_type === 5) {
            if (this.debug)
                console.log("I frame", nalu.length)
        } else if (nalu_type === 7) {
            const next_pos = this.findSequence(nalu, [0, 0, 0, 1], 5)
            if (next_pos > 0) {
                this.sps = nalu.slice(0, next_pos)
                if (this.debug)
                    console.log("sps", next_pos)
                this.processBuffer(nalu.slice(next_pos))
            } else {
                this.sps = nalu
                if (this.debug)
                    console.log("sps", nalu.length)
            }
            let ret = SPSParser.parseSPS(this.sps.slice(4));
            if (this.onNaluCallback) {
                this.onNaluCallback({
                    type: 'size_change',
                    data: {"width" : ret.present_size.width, "height" : ret.present_size.height}
                });
            }
            return;
        } else if (nalu_type === 8) {
            const next_pos = this.findSequence(nalu, [0, 0, 0, 1], 5)
            if (next_pos > 0) {
                this.pps = nalu.slice(0, next_pos)
                if (this.debug)
                    console.log("pps", next_pos)
                this.processBuffer(nalu.slice(next_pos))
            } else {
                this.pps = nalu
                if (this.debug)
                    console.log("pps", nalu.length)
            }
            return;
        } else {
            console.log("unknow frame type", nalu[0], nalu[1], nalu[2], nalu[3], nalu_type)
        }

        if (this.pps != null && this.sps != null) {
            if (this.onNaluCallback) {
                this.onNaluCallback({
                    type: 'init',
                    data: { "width:": this.width, " height:": this.height, "pps": this.pps, "sps": this.sps }
                });
            }
            this.pps = null;
            this.sps = null;
        }
        if (this.onNaluCallback) {
            this.onNaluCallback({
                type: 'nalu',
                data: nalu
            });
        }
    }
}
