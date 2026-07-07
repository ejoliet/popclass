// provider.js — transport-agnostic Yjs sync provider for popclass.
//
// AIDEV-NOTE: transport abstraction — the provider never touches PeerJS.
// It is constructed with a "dataChannelLike" object implementing:
//   send(Uint8Array)            -> void
//   isOpen()                    -> boolean
//   onMessage(fn(Uint8Array))   -> unsubscribe fn
//   onOpen(fn)                  -> unsubscribe fn
//   onClose(fn)                 -> unsubscribe fn
// spike.html wraps a PeerJS DataConnection into this shape; a raw
// RTCDataChannel (premium tier, self-hosted signaling) wraps identically.

import * as Y from 'https://esm.sh/yjs@13.6.31'

// Wire message types. All frames are self-describing binary so the
// protocol survives any transport that can carry bytes (no JSON envelope,
// no binarypack dependency).
export const MSG_SYNC_STEP1 = 0 // payload = Y state vector
export const MSG_SYNC_STEP2 = 1 // payload = Y update diff vs remote state vector
export const MSG_UPDATE = 2 // payload = incremental Y update
export const MSG_CONTROL = 3 // payload = UTF-8 JSON, app-level (e.g. hello)

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

// AIDEV-NOTE: docId multiplexing — one DataChannel per student carries
// many docs. Every frame is tagged {docId, payload}:
//   [ msgType:u8 ][ docIdLen:u16BE ][ docId:utf8 ][ payload:bytes ]
// Each provider instance filters frames by its own docId, so N providers
// (student doc today, class/template doc later) share one channel.
export function encodeFrame (msgType, docId, payload) {
  const docIdBytes = textEncoder.encode(docId)
  const frame = new Uint8Array(3 + docIdBytes.length + payload.length)
  frame[0] = msgType
  frame[1] = docIdBytes.length >> 8
  frame[2] = docIdBytes.length & 0xff
  frame.set(docIdBytes, 3)
  frame.set(payload, 3 + docIdBytes.length)
  return frame
}

export function decodeFrame (frame) {
  const docIdLen = (frame[1] << 8) | frame[2]
  return {
    msgType: frame[0],
    docId: textDecoder.decode(frame.subarray(3, 3 + docIdLen)),
    payload: frame.subarray(3 + docIdLen)
  }
}

// App-level control frames (JSON) ride the same framing with docId ''.
// The provider ignores MSG_CONTROL; spike.html uses it for the student
// "hello" that announces which docIds will flow over the channel.
export function encodeControl (obj) {
  return encodeFrame(MSG_CONTROL, '', textEncoder.encode(JSON.stringify(obj)))
}

export function decodeControl (payload) {
  return JSON.parse(textDecoder.decode(payload))
}

export class YChannelProvider {
  /**
   * @param {Y.Doc} ydoc
   * @param {object} channel dataChannelLike (see header comment)
   * @param {string} docId multiplexing key for this doc on the channel
   */
  constructor (ydoc, channel, docId = 'default') {
    this.ydoc = ydoc
    this.channel = channel
    this.docId = docId
    this.synced = false
    this.destroyed = false
    this.onSynced = null // optional app callback, fired after sync step 2

    // Relay local edits (origin !== this avoids echoing remote updates).
    this._updateHandler = (update, origin) => {
      if (origin !== this && !this.destroyed) this._send(MSG_UPDATE, update)
    }
    this.ydoc.on('update', this._updateHandler)

    this._unsubs = [
      channel.onMessage((bytes) => this.handleMessage(bytes)),
      // AIDEV-NOTE: reconnect logic (provider side) — the sync handshake
      // re-runs on EVERY channel open, not just the first. A reopened (or
      // freshly injected) channel always triggers a full state-vector
      // exchange, so any updates missed while offline are recovered as a
      // single diff. No op log, no sequence numbers: Yjs state vectors
      // make resync idempotent and order-insensitive.
      channel.onOpen(() => this._startSync()),
      channel.onClose(() => { this.synced = false })
    ]
    if (channel.isOpen()) this._startSync()
  }

  // AIDEV-NOTE: sync handshake — symmetric two-step, both directions:
  //   A -> B : SYNC_STEP1 (A's state vector)
  //   B -> A : SYNC_STEP2 (everything B has that A is missing)
  // Both peers send STEP1 on open, so after one round trip each side holds
  // the union of both docs. Incremental MSG_UPDATE frames flow afterwards.
  _startSync () {
    this.synced = false
    this._send(MSG_SYNC_STEP1, Y.encodeStateVector(this.ydoc))
  }

  handleMessage (bytes) {
    if (this.destroyed) return
    const { msgType, docId, payload } = decodeFrame(bytes)
    if (docId !== this.docId) return // frame belongs to another doc/provider
    if (msgType === MSG_SYNC_STEP1) {
      this._send(MSG_SYNC_STEP2, Y.encodeStateAsUpdate(this.ydoc, payload))
    } else if (msgType === MSG_SYNC_STEP2 || msgType === MSG_UPDATE) {
      Y.applyUpdate(this.ydoc, payload, this) // origin=this, see _updateHandler
      if (msgType === MSG_SYNC_STEP2 && !this.synced) {
        this.synced = true
        this.onSynced?.()
      }
    }
  }

  _send (msgType, payload) {
    if (!this.channel.isOpen()) return // handshake on next open covers this
    this.channel.send(encodeFrame(msgType, this.docId, payload))
  }

  destroy () {
    if (this.destroyed) return
    this.destroyed = true
    this.synced = false
    this.ydoc.off('update', this._updateHandler)
    for (const unsub of this._unsubs) unsub()
  }
}
