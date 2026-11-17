// Desired listening state is kept independently from a running recognizer.
class VoiceSession {
  constructor({ start, stop, notify }) { this.start = start; this.stop = stop; this.notify = notify; this.enabled = false; this.active = false; this.busy = false; }
  state(text) { const value = { active: this.enabled && !this.active, enabled: this.enabled, session: this.active, text }; this.notify(value); return value; }
  setListening(enabled) { this.enabled = enabled; this.stop(); if (enabled && !this.active) { try { this.start(); } catch(e) { this.enabled=false;this.state(e.message);throw e; } } return this.state(this.active && enabled ? '会話中のため音声起動を一時停止しています' : enabled ? '音声認識を準備中…' : '音声起動を停止しました'); }
  begin() { if (this.busy || this.active) throw Error('会話を開始済みです。「会話終了」を押してから次を開始してください'); this.busy = true; this.active = true; this.stop(); this.state('会話中: 音声起動を一時停止しています'); }
  started() { this.busy = false; this.state('会話中: 音声起動を一時停止しています'); }
  fail(uncertain = false) { this.busy = false; this.active = uncertain; if (this.enabled && !uncertain) this.start(); this.state(uncertain ? '開始を確認できません。誤起動防止のため待受を停止中です。起動先で会話を終了してから再開してください' : '自動操作を完了できませんでした'); }
  end() { this.busy = false; this.active = false; if (this.enabled) this.start(); return this.state(this.enabled ? '会話終了。音声起動を再開します' : '会話を終了しました'); }
  disable() { this.enabled = false; this.stop(); return this.state('音声起動を停止しました'); }
}
module.exports = { VoiceSession };
