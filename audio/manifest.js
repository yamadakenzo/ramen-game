// tools/audio-manifest.js が生成する。手で編集しない(音源を置いたら node tools/audio-manifest.js を走らせる)。
// audio/ からの相対パス → バイト数。js/audio.js はここに載っているファイルだけを要求する(404 を出さないため)。
window.AUDIO_MANIFEST = {
  "bgm/opening.mp3": 2033785,
  "bgm/shop.mp3": 1234008,
  "bgm/title.mp3": 1028862,
  "se/slide.wav": 4014
};
