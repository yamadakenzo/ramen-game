// 店舗の斜め上視点(アイソメトリック)とアニメーション。
// v32(docs/指示書/v32_斜め上視点_指示書.md): 横から見た断面図(枠線+ベタ塗り+絵文字)から、
// img/stage/(床の下地 + 家具・人・丼を画像で重ねる)へ作り直した。
// (v32 当時の下地は floor.webp の1枚絵だった。v36-1 でマスごとの菱形になり、
//  v48-2a/2b でマスごとの本素材へ。floor.webp は v48-2b で削除した。§69-4)
// 客・従業員・設備・物件の絵は v31 で img/ に入れたものをそのまま使う(新しく作らない)。
//
// 座標系(v35、docs/指示書/v35-2_升目基盤_座標系と仮タイル_指示書.md /
// docs/素材仕様_カイロソフト方式.md): x・y は「マス」の連続座標。1マス = 画面上 CELL(48)px 固定で、
// マス(col,row)の中心 = (col+0.5, row+0.5)。部屋が画面に収まらなければはみ出す(第3段階の
// スクロール/ピンチで見せる。「部屋を1画面に収めるために1マスを縮める」ことはもうしない)。
// v32(§3-1)からの継続: 座標は GEO(と部屋の表 ROOMS)だけが出典。CSS(css/style.css の .sv-*)には
// 座標(top/left)を一切持たせない。位置はすべてここからJSがインラインstyleで書く。CSSに残すのは
// 色・枠線・トランジション・アニメーション・接地アンカー(translate(-50%,-100%))だけ
// (詳細はdocs/設計判断記録.md §42、v35の項)。
window.ShopView = (function () {
  var h = window.UI.h;
  var U = window.Utils;
  var AI = window.AssetImage;
  var SEGMENTS = window.DATA.segments.segments;
  var STAFF = window.DATA.characters.staff;
  var EQUIP = window.DATA.property.equipment;

  // v35: 1マス = 画面上 48 CSS px(等倍)。素材仕様(docs/素材仕様_カイロソフト方式.md §2-1)の
  // 決定値。物件が広くなってもこの値は縮めない。
  var CELL = 48;

  // v36-1(docs/指示書/v36-1_斜め視点_座標系_指示書.md): 斜め上からの投影(カイロソフト方式)。
  // 床のマスは画面上で幅TW×高さTHの菱形。2:1(幅の半分が高さ)の標準的なアイソメで、TW=64は
  // 「マスの幅≒人物の背丈(PERSON_HEIGHT_CELLS×CELL=60px)」というカイロソフトの比率に合わせた値。
  // 高さ方向(壁・カウンターの高さ、人物・什器の絵の大きさ)は従来どおりCELL=48を単位にする
  // (絵はそのまま使う。斜めになるのは床と什器の配置だけ)。
  // 画面座標: x(col)が増えると右下へ (TW/2, TH/2)、y(row)が増えると左下へ (-TW/2, TH/2)。
  var TW = 64, TH = 32;

  // v35-3(§2、§44-7の保留を解消): 人物の見た目の背丈は「1マスの何倍か」の定数1つだけで持つ。
  // 1.25マス(60px)= 常設の寸胴(v48-2c から stockpot.webp、1.05マス=50.4px。v48-2b までは🍥の48px規約)より高く、
  // 入口(v48-2c から entrance.webp、幅1マス→高さ約83px)より低い、の中間。客・従業員の画面上の背丈はこの1つの値に揃え、絵ごとの
  // キャンバス余白の違い(客80.47%・従業員78.83%、§43-7実測)はこの比率で割って吸収する。
  // (font-sizeの実値はCSSには書かない。buildScenery()/buildStaff()がここから作って書く)
  var PERSON_HEIGHT_CELLS = 1.25;
  var CUST_VISIBLE_RATIO = 0.8047;  // 客の絵(img/segment/*.webp): 見た目の高さ/キャンバス高さ
  var STAFF_VISIBLE_RATIO = 0.7883; // 従業員の絵(img/character/*.webp): 同上
  function custFontPx() { return PERSON_HEIGHT_CELLS * CELL / CUST_VISIBLE_RATIO; }
  // v37-1(試作): 歩行2コマ(img/segment/walk_a/walk_b.webp、151×256)。客層1種だけに試験適用する。
  // 絵は「下端=キャンバス下端」で切り出してあり、見た目の高さ/キャンバス高さ=1.0000(α>8で実測、§43-7と同じ測り方)。
  // 客の1em(=custFontPx)は80.47%の絵に合わせた値なので、本体のfont-sizeを比率の比で縮めて背丈60pxに揃える。
  // 切り替えは時間ではなく移動量基準: 足元の実位置がWALK_FRAME_CELLSマス進むごとにA/Bを入れ替える。
  var WALK_SEG_ID = "regular";         // 試験適用する客層(チュートリアル開始の物件shotengaiで最初に湧く客層)
  var WALK_VISIBLE_RATIO = 1.0;        // walk_a/b.webp: 見た目の高さ/キャンバス高さ(実測 256/256)
  var WALK_FRAME_CELLS = 1.0;          // 何マス進むごとにコマを替えるか(目視で遅ければ0.5へ)
  var WALK_FRAMES = ["segment/walk_a", "segment/walk_b"];
  // v37-2: 奥向き(画面上方向へ進む)の背中2コマ。切り出しは§50-4と同じ規則の共通枠(y=294〜1786・幅720px)で、
  // 比率はB基準1.0(=正面と同じ)なのでfont-sizeは共用。Aは靴の角度の差で下端2px(60px時0.8px)だけ上がるが許容(調査報告)。
  var WALK_BACK_FRAMES = ["segment/walk_back_a", "segment/walk_back_b"];
  var WALK_BACK_EPS = 0.01; // 1フレームの|Δ(x+y)|がこれ未満なら向きを更新しない(transition終端の揺れ対策)
  function walkFontEm() { return CUST_VISIBLE_RATIO / WALK_VISIBLE_RATIO; }
  // v37-4: 従業員ゆうたの正面2コマ(img/character/walk_yuta_a/b.webp、159×256)。切り出しは§50-4/§51-1と同じ型
  // (2体共通の枠 y=379〜1669・幅800px・各体の中心で横中央揃え・下端=キャンバス下端)なので比率は客の歩行素材と同じ1.0。
  // 従業員の1em(根の font-size = staffFontEm() em)は78.83%の絵向けなので、本体は 0.7883/1.0 em で背丈60pxに揃う。
  // 店内表示は停止中・作業中も walk_a 固定(立ち絵 yuta.webp は店内では使わない。カード・パネル側は w.def のまま)。
  // 奥向き(背中)の素材は v37-5。今回は Δ(x+y)<0 でも正面コマのまま(walk.frames を固定で持つ俳優は向きを見ない)。
  var WALK_STAFF_ID = "yuta";
  var WALK_STAFF_FRAMES = ["character/walk_yuta_a", "character/walk_yuta_b"];
  function staffWalkFontEm() { return STAFF_VISIBLE_RATIO / WALK_VISIBLE_RATIO; }
  function walkImgDef(def, i, frames) { return { img: (frames || WALK_FRAMES)[i], emoji: def.emoji, name: def.name }; }
  function setWalkFrame(a, i) {
    if (!a.walk) return;
    var back = !a.walk.frames && a.walk.back; // v37-4: 正面固定の素材(従業員)は向きを見ない
    var frames = a.walk.frames || (back ? WALK_BACK_FRAMES : WALK_FRAMES);
    var key = (back ? "b" : "f") + i; // 向きが変わったときはコマ番号が同じでも描き直す
    if (a.walk.key === key) return;
    a.walk.frame = i; a.walk.key = key;
    // <img>の作り方(?v=__BUILD__の付け方・読めないときの絵文字フォールバック)はAI.nodeに任せ、要素ごと差し替える
    var next = AI.node({ img: frames[i], emoji: a.walk.def.emoji, name: a.walk.def.name });
    a.body.replaceChild(next, a.body.firstChild);
  }
  function staffFontEm() { return CUST_VISIBLE_RATIO / STAFF_VISIBLE_RATIO; } // .sv-camera(=客の1em)に対する従業員の倍率

  // v35(v35-2指示書 §1-1): 部屋の表。区画は数式ではなく人が書いた文字の表で持つ(§43-2の教訓)。
  // 記号: L/#/R = 奥壁(左角/中間/右角)  l/r = 側壁(左/右)  D = 入口(暖簾)
  //       K = 厨房床(タイル)  ( = ) = カウンター(左端/中間/右端。下に敷く床はタイル)
  //       S = カウンター席  A = 通路  T = テーブル席 (S/A/Tの床は木目)
  // カウンターの端の位置も記号で書き切る(式で求めない——表を見るだけで目視検証できるように)。
  var ROOMS = {
    shotengai: {
      cols: 14, rows: 10, // v48-5(§73): 右へ2列広げて14列(cols 0〜13)。右側壁 r は col13
      // v36-2: 入口Dを手前(row9の正面)へ移し、店の外の道(P、rows10-11)を表に足した。
      // 道を表の一部として持つ理由: 入口・湧き場所・行列の置き場がすべて同じマス座標で書け、
      // 変換関数1つで済む(§43-1)。部屋の外の別座標系を持つと、出典が2つになる。
      // 手前側の2辺(右=col13の外面、手前=row末尾)の壁は描かない(§1、PIECE_CLSの注記)。
      // v48-5(docs/完了/v48-5_店の拡幅と厨房の隙間_指示書.md、§73): **店を右へ2列広げて14列にした。** 広がった2列のうち
      // row3(カウンターの行)は台を延ばさず床 P(厨房の市松を続ける)にして、従業員が厨房とホールを行き来できる隙間にする。
      // P は FLOOR_CLS で床を敷くだけで、部品(PIECE_CLS)にも機器の置き場(canPlace は K だけ)にも入れない——通路を塞げないように。
      // 席は10のまま(counterSlots)。GEO・PROPS の既定・state.props は絶対座標で col0 側が動かないので不変。
      // 隙間を通る動作(配膳の経路)は別版。いまはカウンターをすり抜ける直線移動のまま(v48-5 調査 1-2)。
      map: [
        "L############R", // row0 奥壁
        "lKKKKKKKKKKKKr", // row1 厨房(cols1〜12。v48-5 で右へ2列)
        "lKKKKKKKKKKKKr", // row2 厨房
        "l(========)PPr", // row3 カウンター(左端 col1+中間×8+右端 col10)。v48-5: 右端 ) の先の cols11〜12 は隙間 P(床のまま。厨房⇄ホールの通り道)、r は col13
        "lSSSSSSSSSSAAr", // row4 カウンター席(cols1〜10=商店街のcounterSlots=10と一致)。v48-5: cols11〜12 は通路 A(隙間から下りる列。枠に見える床を作らない)
        "lAAAAAAAAAAAAr", // row5 通路
        "lTTTTTTTTTTAAr", // row6 テーブル席(卓の帯は cols1〜10 のまま。v48-5: 右2列は通路)
        "lTTTTTTTTTTAAr", // row7 テーブル席
        "lAAAAAAAAAAAAr", // row8 通路
        "lAAAADAAAAAAAr"  // row9 通路。入口D(暖簾)は正面(row9とrow10の境)のcol5
        // v48-2c(§70): row9 の D は v36-2 から index 6(col6)に書かれていて、GEO.door(5.5)・客の経路(lane 5.5)・
        // 行列の起点(x−y=−4)より1マス右に入口が描かれていた(v48-2c 調査 1-2 で実測)。col5 へ直した。
        // 画面の上では入口の絵が1マス左へ動くだけで、経路・行列・GEO は1文字も変えていない。
      ],
      // v36-3: 店の外(町)。同じマス座標で、col0/row0 から始まる1枚の表(店の区画 '.' は描かない)。
      // v48-1(docs/指示書/v48-1_敷地の器_指示書.md、設計判断記録 §67): **店の外を「敷地」として作り直した。**
      // v47(未マージ、§66)は店の表そのものを広げたが、欲しかったのは「店の外に一段外側の器＝敷地を作り、
      // その中に店と小屋を置く」形だった。**店の表(12列×10行)は1文字も触っていない**——広げたのはこの表だけ。
      //
      // 記号: F=フェンス(0.5マス高) O=門(フェンスの切れ目。部品なし、地面は道と同じ)
      //       T=土(敷地の地面) G=草地(四隅。v48-2 の増設用) S=前庭の道
      //       W=歩道 C=車道 B=向かいの建物(1.5マス高) E=隣地の地面(フェンスの外。無地) .=店(別の表)
      //
      // 配置の根拠(基準の絵 Higgsfield 616043f0-… / c5f104be-… の2枚から確定):
      //  - **店は敷地の真ん中。** 店(cols0-11・rows0-9)の周りに、奥5行・左5列・右5列・手前4行の地面を敷く。
      //    奥と左右の5マスは、v48-2 で小屋(各4×4マス+通路1マス)が置ける広さとして決めた。
      //  - **入口(暖簾)は前庭に向く。** 前庭の道 S は店の正面(rows10-11、幅2マス。行列の行と歩く行を分ける)を
      //    左へ敷地の端まで伸ばし、そこから手前へ折れて門へつながる。
      //  - **門 O は左手前の角の隣**(col-5、row14)の1マス。門の外が歩道、その先が通り。
      //  - **通りの向こうにだけ屋根つきの他人の建物**(B、rows20-21)。左・奥・右は隣地の地面(E)を2マス置くだけで、
      //    建物も塀も置かない(v36-3 の左隣の建物 N と右隣の塀・建物はここで撤去した)。
      //  - 区画の境目は仕切りではなく**地面の色**だけで分ける(§66-4 と同じ方針)。
      //  - **フェンスのマスにも足元の地面を敷く**(§66-5 の規則を最初から適用。敷かないと黒い筋が出る)。
      town: {
        col0: -8, row0: -8,
        map: [
          "EEEEEEEEEEEEEEEEEEEEEEEEEEEE", // row -8  隣地(フェンスの外。無地の地面2マス)
          "EEEEEEEEEEEEEEEEEEEEEEEEEEEE", // row -7
          "EEFFFFFFFFFFFFFFFFFFFFFFFFEE", // row -6  フェンス(奥)
          "EEFGGTTTTTTTTTTTTTTTTTTGGFEE", // row -5  敷地の奥の5行。四隅は草地(v48-2 の増設用)
          "EEFGGTTTTTTTTTTTTTTTTTTGGFEE", // row -4
          "EEFTTTTTTTTTTTTTTTTTTTTTTFEE", // row -3  v48-2 はここに小屋2棟(各4×4+通路1)
          "EEFTTTTTTTTTTTTTTTTTTTTTTFEE", // row -2
          "EEFTTTTTTTTTTTTTTTTTTTTTTFEE", // row -1
          "EEFTTTTT..............TTTFEE", // row  0  '.' が店(cols0-11 rows0-9)。左右に敷地が5列ずつ
          "EEFTTTTT..............TTTFEE", // row  1
          "EEFTTTTT..............TTTFEE", // row  2
          "EEFTTTTT..............TTTFEE", // row  3
          "EEFTTTTT..............TTTFEE", // row  4
          "EEFTTTTT..............TTTFEE", // row  5
          "EEFTTTTT..............TTTFEE", // row  6
          "EEFTTTTT..............TTTFEE", // row  7
          "EEFTTTTT..............TTTFEE", // row  8
          "EEFTTTTT..............TTTFEE", // row  9  店の最終行。入口 D は店の表の (5,9)
          "EEFSSSSSSSSSSSSSSSSSTTTTTFEE", // row 10  前庭の道(入口の前。行列が並ぶ行)
          "EEFSSSSSSSSSSSSSSSSSTTTTTFEE", // row 11  前庭の道(歩く行)
          "EEFSSGGGTTTTTTTTTTTTTTTGGFEE", // row 12  道が門へ折れる / 左手前と右手前は草地
          "EEFSSGGGTTTTTTTTTTTTTTTGGFEE", // row 13
          "EEFOFFFFFFFFFFFFFFFFFFFFFFEE", // row 14  フェンス(手前)。門 O は左手前の角の隣(col-5)の1マス
          "WWWWWWWWWWWWWWWWWWWWWWWWWWWW", // row 15  歩道(フェンスの外)
          "WWWWWWWWWWWWWWWWWWWWWWWWWWWW", // row 16
          "CCCCCCCCCCCCCCCCCCCCCCCCCCCC", // row 17  車道
          "CCCCCCCCCCCCCCCCCCCCCCCCCCCC", // row 18
          "CCCCCCCCCCCCCCCCCCCCCCCCCCCC", // row 19
          "BBBBBBBBBBBBBBBBBBBBBBBBBBBB", // row 20  向かいの建物(1.5マス)
          "BBBBBBBBBBBBBBBBBBBBBBBBBBBB" // row 21
        ]
      }
    }
  };
  // 商店街以外の物件は今回対象外で、商店街の表を流用しているだけ(未対応の明示。v35-2指示書の指定)。
  // 特にオフィス街はcounterSlots=14で、この表の席の行(内側10マス)には入りきらない。
  // 物件を本対応するときは物件ごとの表を足すこと(docs/設計判断記録.md v35の項参照)。
  function roomDef() {
    var p = state && window.Scoring.getProperty(state);
    return (p && ROOMS[p.id]) || ROOMS.shotengai;
  }

  // v48-2c(docs/完了/v48-2c_立ち物4点_指示書.md、§70) / v48-2d(§71): **マスの上に立てる本素材(img/stage/)の表。**
  // stool.webp / bowl.webp(256×256 の正方形に余白込みで置いた絵)と違い、この4枚は**余白なしの縦長**
  // (周囲 4px の透明だけ。v48-2c 調査 1-1 で bbox.js 実測)。「48px 角に contain」の1本では
  // 入口が幅 37px・寸胴が高さ 48px にしかならないので、**1枚ごとに大きさの根拠を持つ**:
  //   heightCells = 見た目の高さ(実体)を何マス(CELL)にするか / widthCells = 見た目の幅(実体)を何マス(TW)にするか
  // 描画は .shop-stage img の「1em 角に contain」のまま(縦長なのでキャンバスの高さ=1em、幅=1em×W/H)。
  // font-size(=1em)だけを propFontPx() で計算して要素に書く(CSS には px を書かない。§42)。
  // W/H = キャンバス、ink = 実体の外接矩形(bbox.js、α>8)。値を変えたら bbox.js で測り直すこと。
  //
  // v48-2d(§71): **置き場所もこの表が正**になった(v48-2c は寸胴・茹で麺機の足元を GEO の停止点から「+1行」で導き、
  // 入口は表 ROOMS の D から取っていた——出典が3つに散っていて、入口の1マスずれ(§70-1)はそこで起きた)。
  //   cell  = 足元(マスの連続座標。placeAt に渡す点)
  //   work  = 従業員がその設備で作業するときの立ち位置の、足元からの相対。**GEO.soup / GEO.noodle はここから導く**(直値を持たない)
  //   flip  = 左右反転(.sv-prop.flip。客の .flip と同じ scaleX(-1)、足元は動かない)
  //   baseY = 絵の「接地線」がキャンバスの上から何割の高さを横中央で通るか。省略=下端(1.0)。
  //           アイソメの絵は接地が点ではなく斜めの線で、入口は最下点(右の柱の底)より接地線の中央が 98px 上にある(v48-2d 調査 1-1)。
  //           propNode() が font-size×(1−baseY) だけ絵を下へずらし、**接地線の中央を足元に置く**。
  // 丸椅子(席の数ぶん複数、座標は seats[])と丼(俳優に付属)はこの表に入れない(v48-2d 調査 1-4)。
  var PROPS = {
    // 入口(暖簾+格子戸)。幅=1マス(TW=64px)ちょうど。高さは縦横比なり(≈83px、1.74マス。側壁 48px より高く奥壁 96px より低い)。
    // 足元は**店の正面の辺の中点**(row9 と row10 の境、col5)。客の経由点 GEO.door はこの1マス奥(cell.y−0.5)。
    // 接地線 baseY = 848/946(v48-2d 調査 1-1: 左の柱の底 (30,669) → 右へ傾き 0.53、横中央 x=365 で y≈848)
    entrance:      { W: 731, H: 946, ink: { w: 723, h: 942 }, widthCells: 1, cell: { x: 5.5, y: 10.0 }, baseY: 848 / 946 },
    // 寸胴・茹で麺機。奥に立つ従業員(背丈 60px、1行奥=画面上 16px 上)の胸の高さ=足元から約 52px。2つ同じ値。
    // 従業員は絵の**奥(−y、背中側)**の1行に立って作業する(work.dy = −1。v48-2c と同じ型)。
    // v48-4a-2: 壁際 row1 に置いたときは手前 row2 に立つ(workFor が向きを決める。表の work は既定の向き)。
    stockpot:      { W: 594, H: 886, ink: { w: 586, h: 882 }, heightCells: 1.05, cell: { x: 8.5, y: 2.5 }, work: { dx: 0, dy: -1 } },
    // 茹で麺機。v48-2d: 左奥(col4)へ動かし、**左右反転して正面(引き戸とつまみ)を +y=カウンター側(画面左下)へ向ける**。
    // 残骸を削った後の寸法(§70)。反転しても 2:1 のアイソメは崩れない(v48-2d 調査 1-2)
    noodle_boiler: { W: 757, H: 835, ink: { w: 749, h: 827 }, heightCells: 1.05, cell: { x: 4.5, y: 2.5 }, work: { dx: 0, dy: -1 }, flip: true },
    // レジ(台つき)。カウンターの天板(0.6マス=28.8px)より高く、丸椅子(見た目 38px)より大きい。
    // 足元は入口の内側(A帯)の左端。券売機・POSレジの「1枠」でもある(GEO.ticket はここから導く)
    register:      { W: 561, H: 763, ink: { w: 553, h: 755 }, heightCells: 0.95, cell: { x: 1.5, y: 8.5 } }
  };
  // v48-4a(docs/完了/v48-4a_配置モード_指示書.md、§72): 置き場所は state.props[id] = {x, y} が上書きし、無ければ表の既定 cell。
  // 読むのは propCell() の1か所だけ——描画(placeProp)も停止点(refreshGeo)も「置けるか」(canPlace)も同じ答えを見る。
  // 旧セーブに props は無い(SAVE_VERSION は 25 のまま。resultYear と同じ「上げずに既定で補う」作法。§65)。
  var MOVABLE = ["stockpot", "noodle_boiler", "register"]; // 4a で動かせる物。入口は 4b、丸椅子は 4c(v48-4a 調査 1-6)
  function propCell(id) {
    var o = state && state.props && state.props[id];
    return (o && isFinite(o.x) && isFinite(o.y)) ? { x: o.x, y: o.y } : PROPS[id].cell;
  }
  // v48-4a-2(docs/完了/v48-4a-2_厨房機器を壁際にも_指示書.md、§72-8): **停止点の向きは置いた行で決まる。**
  // 表の work は「既定の向き(奥=−1行)」。その先が厨房の床 K でなければ(壁際 row1 に置いたとき、先は奥壁 row0)
  // 逆向き(手前 +1行)にする——コックは壁に向かって作業する。表は変えず、読む側 workFor() の1か所で決める。
  // canPlace(候補のマス)と refreshGeo(いまのマス)の両方がこれを通るので、光るマスと停止点が食い違わない。
  function workFor(id, cell) {
    var w = PROPS[id].work;
    if (!w) return null;
    var fwd = { x: cell.x + w.dx, y: cell.y + w.dy };
    if (cellSym(fwd.x, fwd.y) === "K") return fwd;
    var back = { x: cell.x - w.dx, y: cell.y - w.dy };
    return cellSym(back.x, back.y) === "K" ? back : fwd;
  }
  function workPoint(id) { return workFor(id, propCell(id)); }

  // v35: 間取りの名前付きの点。単位はマスの連続座標(マス(col,row)の中心 = (col+0.5, row+0.5))。
  // 部屋の表(ROOMS)に載らない可動物・小物の置き場所はここが唯一の出典。
  // v48-2d(§71): 立ち物(PROPS)に結びつく点は**PROPS から導く**(door / soup / noodle / ticket)。直値を2か所に持たない。
  var GEO = {
    // v36-2: 入口の中心=マス(5,9)。店の正面(手前)。v48-2d: 入口の絵は PROPS.entrance.cell(正面の辺の中点 (5.5,10.0))に立ち、
    // 客の経由点はその1マス奥(=マスの中心)。表 ROOMS の D は「壁の切れ目」の意味だけで、座標の出典にはしない
    door: { x: PROPS.entrance.cell.x, y: PROPS.entrance.cell.y - 0.5 },
    // v48-5b(§74): 入口の開口の幅(マス)。正面の腰壁はこの幅ぶんだけ入口の列で切る(doorCols())。いまは1、v48-6 で2にする。
    // 絵の幅(PROPS.entrance.widthCells)とは別に持つ——開口を2マスにしても暖簾の絵を作り直すまでは絵の幅が変わらない
    doorWidth: 1,
    // v48-1: 湧き/退場先 = **門の外の歩道の左端**(row15、門から3マス)。v36-3 は「通りの向こうへ消える」
    // 置き方(右隣の建物の先)だったが、敷地に門ができた以上、客は**門へ向かって歩道を歩いてくる**のが筋。
    // 通りを渡らせないので車道のマスは一度も踏まない。退店も同じ点へ戻る。
    off: { x: -7.5, y: 15.5 },
    // v48-1: 門(表の O = マス(-5,14))の中心と、門から前庭の道へ上がる列。
    // 経由点は**全部この GEO から組み立てる**——直値を経路の関数に置くと、表を伸ばしたときに
    // 追従漏れが起きる(§66-1 の教訓。v47 は 19 か所を手で +2 する羽目になった)。
    gate: { x: -4.5, y: 14.5 },
    gateLane: { x: -4.5 },   // 門から前庭の道へ上がる列(表の S。cols-5〜-4 の2マス幅の左側)
    // v36-3: 店の中の動線(入口から席まで、壁・什器を通り抜けない道筋)。入口の列(col5)は卓(cols2-4・6-8)の間の
    // 通路で、row5(A)がカウンター席の前の通路、row8(A)が卓の手前の通路。席との行き来は必ずこの3本を経由する
    lane: { x: 5.5 },        // 入口の列(奥へ向かう通路)
    aisleRow: 5.5,           // カウンター席の前の通路(row5)
    frontRow: 8.5,           // 卓の手前の通路(row8)
    yardRow: 10.5,           // v48-1: 前庭の道のうち**歩く行**(row10。入口の真ん前。行列もこの行に並ぶ)
    walkRow: 15.5,           // v48-1: 門の外の歩道(row15)。**店の前ではなく敷地の外**になった(旧 10.5=店の前)
    kitchenHome: { x: 7.5, y: 2.5 }, // 厨房担当の定位置の基準(K帯。複数人は左右にspread)
    // v48-4a: soup / noodle / ticket は PROPS(と state.props)の**コピー**。読み込み時はここで既定から作り、
    // mount と「動かした直後」に refreshGeo() が書き直す(v48-4a 調査 1-2: コピーのままだと追従しない)
    soup: workPoint("stockpot"),        // 寸胴の停止点(K)。v48-2d: 絵の1行奥 = 既定 (8.5, 1.5)
    noodle: workPoint("noodle_boiler"), // 茹で麺器の停止点(K)。v48-2d: 絵の1行奥 = 既定 (4.5, 1.5)。購入設備の絵もここ
    plate: { x: 6.5, y: 2.5 },       // 盛り付け台=受け渡し口の立ち位置(K。カウンターのすぐ奥。絵は無い)
    hallHome: { x: 5.5, y: 5.5 },    // ホール担当の定位置(A。カウンターの手前)
    ticket: propCell("register"),    // v36-2: 券売機(A。入口のある手前の通路の左端)。v48-2c: レジの1枠 = register の足元
    counterSeatRow: 4.5,             // 丸椅子の行(表のS行)の中心。席はcol1から1マスに1脚
    // テーブル卓(2マス幅)の接地中心(T帯)。drawMaxTable=4席=2卓ぶんだけ持つ
    tableAnchors: [{ x: 3.0, y: 6.5 }, { x: 7.0, y: 6.5 }],
    // v48-1: 行列は前庭の道(row10)に、入口の前から**門の方向(−x)へ**並べる。GEO.queueColsで折り返す。
    // **v36-2 とは向きが逆。** 道の先が右(+x)ではなく左(門)になったので、行列も門へ向かって伸びる
    // ——並んでいる客の列がそのまま「門から入ってきた順」に見える。折り返しの規則は変えていない。
    // **起点は v36-2 と同じ (6.5, 10.5) のまま。** この投影では画面の横位置は (x−y) だけで決まるので、
    // 入口(5.5, 9.5)と (6.5, 10.5) は**画面の上では同じ列**(x−y = −4.0)——つまりこの点はもともと
    // 「入口の真ん前」だった。向きを反転するときに起点まで鏡にして (4.5, 10.5) にすると、
    // 画面の上では行列が入口より2マス左から始まってしまい、4人目が画面の外へ出る(実測で踏んだ)。
    // **動かすのは進む向き(queueColStep)だけでよい。**
    queueOrigin: { x: 6.5, y: 10.5 },
    queueColStep: { dx: -1.0, dy: 0 },  // 列の中で1人ずつ進む方向(道に沿って門へ)。1.0マス(0.7だと隣と体が重なって数えられない。v36-2の実測)
    queueRowStep: { dx: 0, dy: 0.9 },   // 列が埋まったら次列(row11=道の手前側)
    queueCols: 4,
    // v48-1(§2-5): 初期表示で画面の中央に置く点。この投影では画面の横位置は (x−y) だけ、
    // 縦位置は (x+y) だけで決まる(toPxX/toPxY 参照)ので、「何を中央に置くか」は
    // **どの (x−y) と、どの (x+y) を中央にするか**という2つの選択になる。**実測で選んだ:**
    //
    // 横 x−y = −1.5:
    //   優先順は 1=入口と行列 > 2=カウンター席全部 > 3=卓 > 4=門(§2-5)。0.95 での横の窓は
    //   390幅で 12.83マス・360幅で 11.84マスしかなく、**優先1〜2 を全部入れるには 13.0マス要る**
    //   (行列4人目 x−y=−7.0 〜 10席目 +6.0)。入りきらないので優先順に従い、
    //   **10席目を半マス外へ出した**(390幅で 0.6マス=18px。開店時に持つ6席目は x−y=+2.0 で中央付近)。
    //   x−y=0(v47 のホール定位置)だと逆に**行列の4人目が画面の外**へ出る——行列は
    //   「並んでいるのが見えること」自体が機能なので、そちらを優先した。
    // 縦 x+y = 11.0:
    //   **v36-3 までの「縦にはみ出したら奥壁を画面の上端に合わせる」規則は、敷地が店の奥へ
    //   伸びた時点で成り立たなくなった。** その規則のままだと画面の上 40%(77〜411px)が
    //   奥の土と隣地だけで埋まり、店が下半分に沈み、向かいの建物が画面の外へ出る(実測)。
    //   横と同じく中央に置く点を決める形へ変えた。11.0 は入口(x+y=15)とカウンター席(6〜15)と
    //   卓(9.5〜13.5)がまとまって入り、かつ通りまで見える値。
    camCenter: { x: 4.75, y: 6.25 },  // x−y = −1.5 / x+y = 11.0
    drawMaxTable: 4 // テーブル側は実際の卓数より多くは描かない(絵は代表表示。v24からの既存方針)
  };
  // v48-4a(§72): 立ち物に結びつく GEO の点を PROPS と state.props から書き直す。mount() と moveProp() が呼ぶ。
  // 進行中のサイクル(runSoloCycle/runKitchenCycle の stops)は開始時に座標を固定しているので追いかけない——
  // 1サイクルは旧座標で終わり、次のサイクルからここで書き直した点を読む(v48-4a 調査 1-2、指示書 §2-2)。
  function refreshGeo() {
    GEO.soup = workPoint("stockpot");
    GEO.noodle = workPoint("noodle_boiler");
    GEO.ticket = propCell("register");
  }
  // v48-5b(§74): 正面の腰壁を切る列。入口の中心 GEO.door.x から幅 GEO.doorWidth ぶん(幅1なら入口のマスだけ、幅2なら入口のマスとその右)。
  // 切れ目の出典はここ1か所。入口を動かす(v48-6)ときも GEO.door が動けば追従する
  // v48-5c(§75): 腰壁の窓の出し分け。**col/row だけで決める**(乱数・状態・時刻を使わない。土の3種・市松と同じ作法 §68-8)。
  // 正面 col2・col8 = 角の格子窓、col11 = 細長の紺格子窓、右辺 row6 = 丸窓、それ以外は無地(指示書 §0)。
  function lowWallVariant(side, col, row) {
    if (side === "front") {
      if (col === 2 || col === 8) return "win-square";
      if (col === 11) return "win-slit";
      return "";
    }
    return row === 6 ? "win-round" : "";
  }
  function doorCols() {
    var start = Math.floor(GEO.door.x - (GEO.doorWidth - 1) / 2), cols = [];
    for (var i = 0; i < GEO.doorWidth; i++) cols.push(start + i);
    return cols;
  }

  // v12-1: 各フェーズの尺は「ゲーム内で何分か」で持ち、gm()でwindow.BASE_HOUR_MS(js/utils.js の
  // 1箇所だけ)から実ms(×1基準)を作る。later()/move()は1x基準のmsを受け取って内部でspd()で
  // 割る作りなので、ここでも1x基準のまま渡す(実時間へは変換しない)。
  // 下の分数値は、旧基準(1時間=5000ms@×1)のときに実際に使っていた実秒の直値を「その時点で
  // 何ゲーム内分だったか」に換算しただけで、体感の尺そのものは変えていない
  // (BASE_HOUR_MSを変えても客の動きが速すぎ/遅すぎにならないようにするための書き換え)。
  var OLD_MS_PER_MIN = 5000 / 60; // 換算の物差し。以後この値そのものを直接使うことはない
  // v35: 距離の単位が「舞台%」から「マス」へ変わったため、旧「1% = 22ms/20ms」を換算係数
  // k=10(%/マス)で「1マス = 220ms/200ms」へ校正した。kは現行GEO(%)と新配置(マス)で同じ
  // 代表旅程(入店/厨房/ホール/退店/兼任1周)の距離を実測して求めた比の平均(≈10.2、
  // 第2段階着手前報告)。この校正で旅程の所要時間と、厨房サイクルの移動:静止の配分
  // (0.62→0.61)が現行とほぼ同じに保たれる。
  var WALK_MIN_PER_CELL = 220 / OLD_MS_PER_MIN;      // 通常の歩行、距離1マスあたりの分
  var SEAT_WALK_MIN_PER_CELL = 200 / OLD_MS_PER_MIN; // 席へ向かう/席から出るときの歩行
  var ENTER_EXTRA_MIN = 200 / OLD_MS_PER_MIN;        // 席へ向かう前の一拍
  var SIT_MIN = 420 / OLD_MS_PER_MIN;                // 席に着く/席を立つ(間合いの一拍)
  var LEAVE_WAIT_MIN = 460 / OLD_MS_PER_MIN;         // 席を立ってから実際に歩き出すまでの間
  var QUEUE_REFLOW_MIN = 500 / OLD_MS_PER_MIN;       // 行列の詰め直し
  // v16-2/3: 我慢の限界。「並んで待つ」「着席して丼を待つ」の両方でこの1本だけを使う
  // (指示書3番「別々の仕組みを作らない」への対応。v15までは行列側は確率判定、着席側は決定的な
  // タイマーと、別の仕組みが2つあった)。新しい数値は増やさず、既存の客層データ(queue_tolerance)
  // だけで個体差を付ける。v15時点の値(48〜156分)は、通常営業(従業員2人・満席でない)でも
  // 頻発するほど短すぎたため、v16で十分に長く取り直した(150〜300分。詳細はPROGRESS.md参照)。
  var PATIENCE_BASE_MIN = 150;
  var PATIENCE_TOL_MIN = 150;
  var MEAL_MIN_MIN = 2500 / OLD_MS_PER_MIN;          // 提供+食事(最短)。約30分
  var MEAL_MIN_MAX = 3500 / OLD_MS_PER_MIN;          // 提供+食事(最長)。約42分
  var RESUME_FLOOR_MIN = 200 / OLD_MS_PER_MIN;       // 一時停止/速度変更からの再開時の最短尺
  // v35: RESUME_Y_MIN_PER_PCT は参照0件の死にコードだったため削除(単位変換の対象を減らす。
  // v35-2指示書 §1-3。walkMs()も同じ理由で削除済み)
  // v13-1: 厨房の作業ポーズの基準値(ゲーム内分)。
  // v28-2(docs/指示書/v28-2追補2_移動時間を含めた目標間隔の実現.md §J)以降、これらは
  // 「pace=1のときの基準値」としてのみ使う。実際の所要時間は目標間隔(targetIntervalMin()、
  // Scoring.staffProcessingCapacity()由来のW、window.Scoring.totalSeats()×
  // window.SEATS_TO_WEEKLY_CAPACITY由来のSから決まる)へ一致するよう、移動時間も含めて
  // 一律にスケールする(runSoloCycle/runKitchenCycle/runHallCycleが1件ごとにpaceを逆算する)。
  // 従業員個人の能力(旧5能力)は絵の速度からは参照しない——Wを決める新4能力と二重に効かせない
  // ため(同追補§J後半)。ここは「絵の忙しさ」のためだけの尺で、週次計算には一切フィードバック
  // しない(この原則自体はv13から変わっていない)。
  var KITCHEN_STATION_MIN = 2.5; // 中継地点(スープ/麺/盛り付け)1箇所あたりの作業ポーズの基準
  var KITCHEN_HANDOFF_MIN = 1;   // 客に渡す一拍の基準
  // v28-2: 週の営業ゲーム分(BANDSの合計×7日)。既存のwindow.BANDSから導出するだけで、
  // 新しい数値は増やさない。他のファイル(loop.js)もDAYS_PER_WEEK=7を前提にしている
  // (週7日はゲーム全体の既存の前提であり、ここで新設する定数ではない)。
  var WEEK_OPERATING_MIN = (window.BANDS || []).reduce(function (s, b) { return s + (b.end - b.start) * 60; }, 0) * 7;

  function gm(min) { return U.gameMinMs(min); }

  var stage = null;      // 舞台のDOM(クリップ枠。動かさない)
  var cameraEl = null;   // v35: カメラ層。床・壁・什器・actorLayerはすべてこの子。
                          // 見る場所・倍率はこの層のtranslate+scaleだけで変える
  // v35-3(§3): カメラの初期値は定数ではなく、部屋の大きさと「HUDに覆われない画面の範囲」から
  // fitCamera()が式で作る(→ docs/設計判断記録.md §45)。camOverride は ?cam=x,y,s(確認専用。
  // ?grid=1と同じ「URLに付けたときだけ」)のときだけ入り、式より優先する。
  var CAM = { x: 0, y: 0, s: 1 };
  var camOverride = null;
  var CAM_GAP = 6; // HUDと部屋の間に空ける余白(px)。元の手置き値(top-bar 70.8 → y 76)と同じ約5〜6px
  var CAM_ZOOM_MAX = 2; // 寄れる限界(素材仕様§2-1のピンチ上限。客の表情の絵文字が十分読める)
  // v36-2 の暫定値。v48-1 で敷地を作ったあとも**据え置き**にした(§2-5)。人物の画面上の背丈 =
  // PERSON_HEIGHT_CELLS×CELL×s = 60×0.95 = 57px。敷地が広がったぶん倍率を下げれば全体は入るが、
  // 引ける限界(fitScale=0.21)まで下げると人物は 12.6px にしかならない。**入りきらない分は
  // スクロールで見に行く**(門は初期表示に入らない。§2-5)。
  var CAM_INIT_S = 0.95;
  var hudObserver = null;
  var camTouched = false; // ユーザーが一度でもカメラを動かしたらtrue(以後HUDの変化で初期表示へ戻さない)

  // HUD(上帯・速度ボタン)に覆われない、舞台(.shop-stage)内の矩形を実測で求める。
  // 横は画面の幅いっぱい(FAB列の下に部屋の右端<右側壁と9〜10席目>がかかるのは許容。
  // チェックポイント1の回答)。要素が無い画面(開業チュートリアルの背景)では舞台全体。
  function viewportFit() {
    var sr = stage.getBoundingClientRect();
    var fit = { left: 0, top: 0, right: sr.width, bottom: sr.height };
    function el(id) { var e = document.getElementById(id); if (!e) return null; var r = e.getBoundingClientRect(); return (r.width && r.height) ? r : null; }
    var tb = el("top-bar"), sd = el("speed-dock");
    if (tb) fit.top = Math.max(fit.top, tb.bottom - sr.top + CAM_GAP);
    if (sd) fit.bottom = Math.min(fit.bottom, sd.top - sr.top - CAM_GAP);
    return fit;
  }

  // 部屋の画面上の大きさ(v36-1: 菱形の部屋の外接矩形。横=(cols+rows)×TW/2、縦=(cols+rows)×TH/2+奥壁の高さ)
  var WALL_RISE = 2 * CELL; // 外接矩形の上端が最奥のマスの床より上に出る量(奥壁・隣の建物2マスぶん)
  // v36-3: 外接矩形は店(ROOMS.map)と町(ROOMS.town)を合わせた範囲
  function roomExtent() {
    var room = roomDef();
    var e = { colMin: 0, colMax: room.cols - 1, rowMin: 0, rowMax: room.rows - 1 };
    if (room.town) {
      e.colMin = Math.min(e.colMin, room.town.col0); e.rowMin = Math.min(e.rowMin, room.town.row0);
      e.colMax = Math.max(e.colMax, room.town.col0 + room.town.map[0].length - 1);
      e.rowMax = Math.max(e.rowMax, room.town.row0 + room.town.map.length - 1);
    }
    return e;
  }
  function roomSize(s) { var e = roomExtent(); var n = (e.colMax + 1 - e.colMin) + (e.rowMax + 1 - e.rowMin); return { w: n * TW / 2 * s, h: (n * TH / 2 + WALL_RISE) * s }; }
  // 外接矩形の上端から、CAM.y(マス(0,0)の菱形の上辺=top 0)までの距離(倍率1)
  function roomRise() { var e = roomExtent(); return WALL_RISE - (e.colMin + e.rowMin) * TH / 2; }
  // 部屋の全体がfit矩形に丸ごと入る最大の倍率(=初期倍率、かつピンチで引ける限界)
  function fitScale(fit) {
    var r = roomSize(1);
    return Math.min(Math.max(1, fit.right - fit.left) / r.w, Math.max(1, fit.bottom - fit.top) / r.h);
  }

  // 部屋がfit矩形を埋め尽くす最小の倍率(=初期倍率。実機確認後の指示: 起動直後は画面が店で
  // 埋まっていること。横にはみ出す分は指スクロールで見る)。上限はピンチと同じCAM_ZOOM_MAX。
  function coverScale(fit) {
    var r = roomSize(1);
    var s = Math.max(Math.max(1, fit.right - fit.left) / r.w, Math.max(1, fit.bottom - fit.top) / r.h);
    return Math.min(Math.max(s, fitScale(fit)), CAM_ZOOM_MAX);
  }

  // 初期表示の式: 倍率は CAM_INIT_S 据え置き。位置は**縦も横も GEO.camCenter を画面の中央に置く**
  // (枠より小さい軸は中央のまま。限界は clampCamera が掛ける)。
  //
  // v48-1(§2-5): **縦の規則を「奥壁を枠の上端に合わせる」から「中央に置く点を決める」へ変えた。**
  // v36-3 までは店の奥に何も無かったので、はみ出す縦を奥壁で揃えれば店が画面の上に来た。
  // 敷地が店の**奥へ5行**伸びた v48-1 では同じ規則が逆に働き、画面の上 40%(77〜411px)が
  // 奥の土と隣地だけで埋まって店が下半分に沈み、通りの向かいの建物が画面の外へ出た(実測)。
  // 横は v36-2 から「どの (x−y) を中央にするか」を選ぶ作りだったので、縦も同じ形に揃えただけ。
  // 中央に置く点そのものと、その決め方は GEO.camCenter のコメントに書いてある。
  function fitCamera() {
    if (camOverride) { CAM = { x: camOverride.x, y: camOverride.y, s: camOverride.s }; return; }
    var fit = viewportFit();
    var s = Math.min(Math.max(CAM_INIT_S, fitScale(fit)), CAM_ZOOM_MAX);
    var r = roomSize(s);
    var fw = fit.right - fit.left, fh = fit.bottom - fit.top;
    var c = GEO.camCenter;
    CAM = {
      s: s,
      x: r.w > fw ? (fit.left + fw / 2 - toPxX(c.x, c.y) * s) : (fit.left + (fw - r.w) / 2),
      y: r.h > fh ? (fit.top + fh / 2 - toPxY(c.x, c.y) * s) : (fit.top + (fh - r.h) / 2 + roomRise() * s)
    };
    clampCamera();
  }

  // 見回しの限界(§6): 倍率は[初期倍率, CAM_ZOOM_MAX]。位置は「部屋がfit矩形より大きい軸では
  // 枠と部屋の間に隙間を作らない／小さい軸では部屋を枠の中に収める」——どこまで動かしても
  // 部屋の外の余白が画面の大半を占めることはない。
  function clampCamera() {
    var fit = viewportFit();
    var sMin = fitScale(fit);
    CAM.s = Math.min(Math.max(CAM.s, sMin), Math.max(sMin, CAM_ZOOM_MAX));
    var r = roomSize(CAM.s);
    var lo = Math.min(fit.left, fit.right - r.w), hi = Math.max(fit.left, fit.right - r.w);
    CAM.x = Math.min(Math.max(CAM.x, lo), hi);
    var top = CAM.y - roomRise() * CAM.s; // 外接矩形の上端
    var tlo = Math.min(fit.top, fit.bottom - r.h), thi = Math.max(fit.top, fit.bottom - r.h);
    CAM.y = Math.min(Math.max(top, tlo), thi) + roomRise() * CAM.s;
  }

  function applyCamera() {
    if (!cameraEl) return;
    cameraEl.style.transform = "translate(" + CAM.x + "px," + CAM.y + "px) scale(" + CAM.s + ")";
  }

  // HUDの高さは描画後に確定する(top-barの中身はmount後にrenderTopBarが書く)ため、
  // HUD・舞台の大きさが変わったら初期表示を計算し直す。ただしユーザーがカメラを動かした後は
  // 勝手に初期表示へ戻さず、限界の中に収め直すだけにする。
  function watchHud() {
    if (hudObserver || typeof ResizeObserver === "undefined") return;
    hudObserver = new ResizeObserver(function () {
      if (!stage) return;
      if (camTouched) clampCamera(); else fitCamera();
      applyCamera();
    });
    hudObserver.observe(stage);
    ["top-bar", "speed-dock"].forEach(function (id) { var e = document.getElementById(id); if (e) hudObserver.observe(e); });
  }

  // ---------- v35-3 §6: 指スクロール・ピンチ(Pointer Events) ----------
  // 1本指: 指の下の場所が指についてくる(drag)。2本指: 中点の下の場所を画面上で動かさずに
  // 寄る/引く。指を離せば止まる(慣性なし)。2回続けてタップで初期表示へ戻す。
  // カメラはstateに持たない(リロードで初期表示に戻る)。舞台(.shop-stage)はHUD(速度ボタン・
  // FAB・パネル)より奥のレイヤーなので、ボタンの上で始まった指はここへ届かない(誤爆しない)。
  var gesture = { pts: {}, start: null, lastTapAt: 0, lastTapX: 0, lastTapY: 0, hit: null }; // hit: v48-4a、pointerdown で触った立ち物
  function ptList() { return Object.keys(gesture.pts).map(function (k) { return gesture.pts[k]; }); }
  function gestureAnchor() {
    var p = ptList();
    if (p.length >= 2) {
      var mid = { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 };
      var d = Math.max(1, Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y));
      // 中点の下にある部屋の点(マスpx)を覚えておき、以後その点が中点に留まるようにする
      gesture.start = { cam: { x: CAM.x, y: CAM.y, s: CAM.s }, mid: mid, d: d, moved: false,
        room: { x: (mid.x - CAM.x) / CAM.s, y: (mid.y - CAM.y) / CAM.s } };
    } else if (p.length === 1) {
      gesture.start = { cam: { x: CAM.x, y: CAM.y, s: CAM.s }, x: p[0].x, y: p[0].y, moved: (gesture.start && gesture.start.moved) || false };
    } else {
      gesture.start = null;
    }
  }
  function onPointerDown(e) {
    if (!stage || !cameraEl) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    var sr = stage.getBoundingClientRect();
    gesture.pts[e.pointerId] = { x: e.clientX - sr.left, y: e.clientY - sr.top };
    // v48-4a(§72): 何を触ったかは pointerdown で記録する。setPointerCapture の後は pointerup の target が舞台になる(調査 1-4)
    gesture.hit = (e.target && e.target.closest) ? e.target.closest("[data-prop]") : null;
    try { stage.setPointerCapture(e.pointerId); } catch (err) { /* 古い環境 */ }
    gestureAnchor();
    e.preventDefault();
  }
  function onPointerMove(e) {
    if (!gesture.pts[e.pointerId] || !gesture.start) return;
    var sr = stage.getBoundingClientRect();
    gesture.pts[e.pointerId] = { x: e.clientX - sr.left, y: e.clientY - sr.top };
    var p = ptList(), st = gesture.start;
    if (p.length >= 2 && st.mid) {
      var mid = { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 };
      var d = Math.max(1, Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y));
      CAM.s = st.cam.s * (d / st.d);
      CAM.x = mid.x - st.room.x * CAM.s;
      CAM.y = mid.y - st.room.y * CAM.s;
      st.moved = true;
    } else if (p.length === 1 && st.x != null) {
      var dx = p[0].x - st.x, dy = p[0].y - st.y;
      if (!st.moved && Math.hypot(dx, dy) < 4) return; // タップの揺れは無視(ダブルタップ判定のため)
      st.moved = true;
      CAM.x = st.cam.x + dx;
      CAM.y = st.cam.y + dy;
    } else return;
    camTouched = true;
    clampCamera();
    applyCamera();
    e.preventDefault();
  }
  function onPointerUp(e) {
    if (!gesture.pts[e.pointerId]) return;
    var was = gesture.start;
    delete gesture.pts[e.pointerId];
    if (!ptList().length && was && !was.moved && was.x != null) {
      // v48-4a(§72): 配置モードが先に取る(立ち物の選択・光ったマスで確定・それ以外で解除)。
      // 取ったときはダブルタップの初期表示戻しを数えない(「物をタップ→マスをタップ」が戻しに化けないように)
      if (onTap(was.x, was.y, gesture.hit)) {
        gesture.lastTapAt = 0;
      } else {
        // タップ。300ms以内・近い場所の2回目なら初期表示へ戻す
        var now = Date.now();
        if (now - gesture.lastTapAt < 300 && Math.hypot(was.x - gesture.lastTapX, was.y - gesture.lastTapY) < 30) {
          camTouched = false;
          fitCamera();
          applyCamera();
          gesture.lastTapAt = 0;
        } else {
          gesture.lastTapAt = now; gesture.lastTapX = was.x; gesture.lastTapY = was.y;
        }
      }
    }
    gesture.hit = null;
    gestureAnchor();
  }

  // ---------- v48-4a(§72): 配置モード(プレイヤーが立ち物を動かす) ----------
  // 型: 立ち物をタップ → 置けるマスが光る → マスをタップで確定。ドラッグは使わない(カメラのドラッグと衝突する)。
  // 営業中もそのまま動く。客・従業員・タイマーには触らない(組み直さない)。
  var placing = null; // { id, cells: [{x,y}], marks: [el] } 選択中だけ持つ
  function cellSym(x, y) {
    var room = roomDef(), col = Math.floor(x), row = Math.floor(y);
    if (col < 0 || row < 0 || col >= room.cols || row >= room.rows) return null;
    return room.map[row].charAt(col);
  }
  function sameCell(a, b) { return Math.abs(a.x - b.x) < 0.01 && Math.abs(a.y - b.y) < 0.01; }
  // 置けるか。**純粋関数**: 表(ROOMS)・PROPS・いまの置き場所(propCell)・持ち物の数(卓)だけを見る。DOM は見ない。
  // 「光るマス」も「確定」もこれ1つで決める(光ったのに置けない/置けるのに光らない、を作らない)。
  function canPlace(id, cell) {
    var p = PROPS[id];
    if (!p || !cell) return false;
    var sym = cellSym(cell.x, cell.y);
    if (!sym) return false;
    // 他の立ち物の足元と停止点は空けておく(入口は動かないが占有はする)
    var taken = [];
    MOVABLE.concat(["entrance"]).forEach(function (o) {
      if (o === id) return;
      var c = propCell(o);
      taken.push(c);
      var ow = workFor(o, c); // v48-4a-2: 相手の停止点も置いた行なりの向きで
      if (ow) taken.push(ow);
    });
    var isTaken = function (c) { return taken.some(function (t) { return sameCell(t, c); }); };
    if (isTaken(cell)) return false;
    if (p.work) {
      // 厨房の設備(寸胴・茹で麺機): 足元も停止点も厨房の床 K。停止点が壁や他の物・他の物の停止点に入る置き方は弾く。
      // v48-4a-2: row1(壁際)も可。そのとき停止点は手前 row2(workFor が向きを決める)。
      // 「row1 col3 と row2 col3」のように前後に並べると、一方の足元がもう一方の停止点に当たるので弾かれる。
      // 寸胴は増設(extra_boiler)が停止点の右隣に描かれるので、そこも厨房の中(col10 は不可)
      var w = workFor(id, cell);
      if (sym !== "K" || !w || cellSym(w.x, w.y) !== "K" || isTaken(w)) return false;
      if (id === "stockpot" && cellSym(w.x + 1, w.y) !== "K") return false;
      return true;
    }
    if (id === "register") {
      // レジ: 客席の床(A/T)のうち、客の動線と席・卓を除いたマス(v48-4a 調査 1-1)。
      // 丸椅子の枠(row4=S)・入口の列(lane)・カウンター前の通路(aisleRow)・卓の客の横移動(frontRow の卓の列の範囲)・入口のマス・卓(購入済み)
      if (sym !== "A" && sym !== "T") return false;
      var col = Math.floor(cell.x), row = Math.floor(cell.y);
      if (col === Math.floor(GEO.lane.x)) return false;
      if (row === Math.floor(GEO.aisleRow)) return false;
      var ax = GEO.tableAnchors.map(function (a) { return a.x; });
      if (row === Math.floor(GEO.frontRow) && col >= Math.min.apply(null, ax) - 1 && col < Math.max.apply(null, ax) + 1) return false;
      if (sameCell(cell, GEO.door)) return false;
      var tables = Math.ceil(seatCounts().table / 2);
      for (var t = 0; t < tables; t++) {
        var a = GEO.tableAnchors[t];
        if (a && sym === "T" && Math.abs(cell.x - a.x) <= 1) return false; // 卓は2マス幅(アンカー±0.5 のマス)
      }
      return true;
    }
    return false;
  }
  function placeableCells(id) {
    var room = roomDef(), cells = [];
    for (var row = 0; row < room.rows; row++) for (var col = 0; col < room.cols; col++) {
      var c = { x: col + 0.5, y: row + 0.5 };
      if (canPlace(id, c)) cells.push(c);
    }
    return cells;
  }
  function startPlacing(id) {
    clearPlacing();
    var cells = placeableCells(id);
    // 光るマス: 床と同じ菱形(clip-path)を床の上・壁(WALL_Z 90)の下に敷く。タップは通す(マスは座標から特定する)
    var marks = cells.map(function (c) {
      var m = block("sv-place-cell", {
        left: toPxX(c.x, c.y) + "px", top: toPxY(c.x, c.y) + "px", width: (TW + 2) + "px", height: (TH + 1) + "px"
      });
      cameraEl.appendChild(m);
      return m;
    });
    propEls[id].classList.add("selected");
    placing = { id: id, cells: cells, marks: marks };
  }
  function clearPlacing() {
    if (!placing) return;
    placing.marks.forEach(function (m) { if (m.parentNode) m.parentNode.removeChild(m); });
    if (propEls[placing.id]) propEls[placing.id].classList.remove("selected");
    placing = null;
  }
  // 確定: state に書く → GEO を書き直す → 要素を置き直す → 保存。組み直さないので客・従業員・タイマーはそのまま
  function moveProp(id, cell) {
    if (!state.props) state.props = {};
    state.props[id] = { x: cell.x, y: cell.y };
    refreshGeo();
    var c = propCell(id);
    if (propEls[id]) placeAt(propEls[id], c.x, c.y);
    anchored.forEach(function (a) { var p = a.at(); placeAt(a.el, p.x, p.y); });
    if (window.GameState && window.GameState.save) window.GameState.save();
  }
  // タップ点(舞台内 px)→マス。カメラ層の translate と scale を戻してから fromPx(一時停止の復帰と同じ逆変換)
  function tapCell(sx, sy) {
    var p = fromPx((sx - CAM.x) / CAM.s, (sy - CAM.y) / CAM.s);
    return { x: Math.floor(p.x) + 0.5, y: Math.floor(p.y) + 0.5 };
  }
  // タップを配置モードが取るなら true(ダブルタップの初期表示戻しには数えない)
  function onTap(sx, sy, hit) {
    var id = (hit && hit.dataset) ? hit.dataset.prop : null;
    if (placing) {
      var cell = tapCell(sx, sy);
      var ok = placing.cells.some(function (c) { return sameCell(c, cell); });
      if (ok) moveProp(placing.id, cell);
      clearPlacing(); // 光っていない場所・別の立ち物・舞台の外は解除
      return true;
    }
    if (id && MOVABLE.indexOf(id) >= 0 && propEls[id]) { startPlacing(id); return true; }
    return false;
  }
  function bindGestures() {
    stage.addEventListener("pointerdown", onPointerDown);
    stage.addEventListener("pointermove", onPointerMove);
    stage.addEventListener("pointerup", onPointerUp);
    stage.addEventListener("pointercancel", onPointerUp);
    gesture.pts = {}; gesture.start = null;
  }
  var actorLayer = null; // 客・店員を載せるレイヤー
  var gridDebug = false; // v35-3(§4): ?grid=1 のときだけtrue
  var state = null;
  var seats = [];        // {x, y, kind, occupant}
  var actors = [];       // 客
  var staffActors = [];  // 互換用。実体はkitchenWorkers(下)
  var queue = [];        // 入店待ちの客
  // v13-1/v14-5: 厨房・ホールの作業動線。1人 = state.staffHired の1人ぶん。
  var kitchenWorkers = []; // {id, def, el, gone, busy, homeX, homeY, curX, curY, role: "kitchen"|"hall"|"both"}
  var orderQueue = [];     // {id, seat, actor} まだ厨房が着手していない注文
  var readyQueue = [];     // {id, seat, actor} 盛り付け済みで、ホールが客席へ運ぶのを待っている丼(=丼の山)。
                            // v32(§37): カウンター席の注文はここを経由せず厨房から直接届ける(下記参照)。
  var orderSeq = 0;
  var orderPileEl = null;  // 積まれた丼を表示するDOM
  var timers = [];       // {fn, remaining(ms), id, startedAt} v09: 残り時間を持たせ、凍結中は完全に止める
  var builtSig = "";
  // v24(指示書§3-3): 前回buildScenery()時点で描いていたカウンター席の所持数。nullは
  // 「まだ一度も描いていない」(=初回描画では席をポップさせない。読み込み直後の6席が
  // いきなり跳ねて出るのを防ぐため)。
  var prevDrawnCounter = null;
  var STOOL_POP_STAGGER_MS = 150; // §3-2手順3: 1席あたり0.15秒間隔(card-reveal.jsのSTAGGER_MSと揃える)
  function reducedMotionSV() {
    return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }
  // v10-3: 週次のcomputeWeeklyCustomersの結果を「曜日×帯」へ配分したもの(js/scoring.jsの
  // weeklyBandSchedule)。openBand()がここから今日・その帯ぶんを取り出して実数だけ湧かせる。
  // 以前あった traffic.pool/occupancy(Math.pow で稼働率を持ち上げる演出)は廃止した
  // (客数と絵が一致しない原因そのものだったため。v10指示3)。
  // v26(追補§B-2): weekは客が湧いた時点の週番号(a.spawnWeekへ渡す元)。priceOwedと同じ経路で
  // traffic経由に1キー足すだけ(新しい仕組みは増やさない)。
  // v28-2: targetIntervalは絵の配膳1杯あたりの目標ゲーム分(T=WEEK_OPERATING_MIN÷min(W,S))。
  // 週替わり・設備/座席購入のたびにupdate()で再計算する(pricePerCustomer/weekと同じ経路)。
  var traffic = { schedule: null, queueLevel: 0, satBySeg: {}, pricePerCustomer: 0, week: 0, targetInterval: WEEK_OPERATING_MIN };
  // v09-1: 中央の pauseReasons(js/screens/loop.js)から setPaused() で渡される、唯一の一時停止フラグ。
  // 以前は state.speed===0 を「止まっている」の代用にしていたが、v09で速度の選択と一時停止を
  // 分離したため(停止中でも「選んでいる速度」自体は保持し続ける)、ここでは専用のフラグを持つ。
  var frozen = false;
  // v12-1: 直近にsyncSpeed()した時点の速度。これと今のspd()がズレていたら「速度が変わった瞬間」と
  // 判定し、画面上の客の残り時間・移動もその場で新しい速度に追随させる(retime())。
  var curSpd = 1;
  // v13-3/v16-1: 丼が客の席に届いた瞬間(deliverToSeat)にloop.js側へ知らせる。その客のpriceOwedを渡す。
  // (v15まではfinishMeal=食べ終わった瞬間だった。v16でタイミングを配膳の瞬間に変更)
  var onServeCb = null;
  // v15-1/6: 客ごとの一生をログに残す(調査用・確認用)。新しい客数計算は一切しない、
  // 既存の状態遷移が起きた時刻を記録するだけの読み取り専用ログ。
  var lifecycleLog = [];
  var custSeq = 0;
  function nowLabel() {
    return U.calMonth(state.day) + "/" + U.dayOfMonth(state.day) + "(" + U.dowLabel(state.day) + ") " + U.timeLabel(state.clockMin);
  }
  function logLifecycle(a) {
    lifecycleLog.push({
      客: "#" + a.id, 客層: (segDef(a.segId) || {}).name || a.segId,
      着席: a.seatedAt || "", 注文: a.orderedAt || "", 丼受取: a.deliveredAt || "",
      食事開始: a.eatStartAt || "", 退店: a.exitAt || "", 退店理由: a.exitReason || ""
    });
  }

  function spd() { return state && state.speed > 0 ? state.speed : 1; }
  function paused() { return frozen; }

  // v35: 重なり順(z-index)はrowから作る、唯一の関数(素材仕様§2-3「z=row」)。「奥の行ほど
  // 先に描く」を満たすため、静物(buildScenery時に1回)・俳優(move()のたびに)の両方がこれを通す。
  // 係数10は、移動中の小数row(例: 5.5)でも単調な整数zになるようにするため。
  // 基準値100を足しているのは、床タイル(z-index無し=0扱い)より必ず上に来るようにするため。
  // v36-1: 奥行きは col と row の両方から決める(x+y が大きいほど画面の下=手前)。式はこの1つだけで、
  // 部品ごとの例外のzは使わない(§46-3)。係数10は小数マスでも単調な整数になるように。
  function zForRow(x, y) { return 100 + Math.round(((x || 0) + (y || 0)) * 10); }

  // v36-1: マス座標→px(唯一の変換関数。§43-1「すべての位置はこの戻り値だけで表す」)。
  // 接地の規約(1つ): **足元(要素の下端中央=CSSの translate(-50%,-100%))を、マスの菱形の中心に置く。**
  // 正方形の投影では「マスの下端中央」だったが、菱形では下端は1点(下の頂点)になって面の手前に
  // 出すぎるため、菱形の中心を接地点にする。全部品・全俳優に同じ規約を適用する。
  // 原点: 部屋の外接矩形の左端(= (0, rows) の頂点)が left=0 になるよう、rows×TW/2 だけ右へずらす。
  function originX() { var e = roomExtent(); return (e.rowMax + 1 - e.colMin) * TW / 2; } // 外接矩形の左端(頂点(colMin,rowMax+1))が left=0
  function toPxX(x, y) { return originX() + ((x || 0) - (y || 0)) * TW / 2; }
  function toPxY(x, y) { return ((x || 0) + (y || 0)) * TH / 2; }
  // 逆変換(一時停止からの再開で、画面上の現在地をマス座標へ戻すのに使う)
  function fromPx(left, top) { var u = (left - originX()) / TW, v = top / TH; return { x: u + v, y: v - u }; }

  // 2点間を(2軸とも動く前提で)n個の等間隔点に割り付ける。旧spread()(横1軸だけ)の2D版。
  function isoSpread(n, p0, p1) {
    var pts = [];
    if (n <= 0) return pts;
    if (n === 1) return [{ x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 }];
    for (var i = 0; i < n; i++) {
      var t = i / (n - 1);
      pts.push({ x: p0.x + (p1.x - p0.x) * t, y: p0.y + (p1.y - p0.y) * t });
    }
    return pts;
  }

  // 凍結中は新規タイマーを仕込むだけで実際にはarmしない(unfreezeで一括再開する)。
  function armTimer(rec) {
    rec.startedAt = Date.now();
    rec.id = setTimeout(function () {
      var i = timers.indexOf(rec);
      if (i >= 0) timers.splice(i, 1);
      rec.fn();
    }, Math.max(16, rec.remaining));
  }

  function later(fn, ms) {
    var rec = { fn: fn, remaining: Math.max(16, ms / spd()), id: null, startedAt: 0 };
    timers.push(rec);
    if (!frozen) armTimer(rec);
    return rec;
  }

  function clearTimers() {
    timers.forEach(function (rec) { if (rec.id) clearTimeout(rec.id); });
    timers = [];
  }

  // ---------- v09-1: 一時停止(パネル・モーダル・週末停止・非表示タブ)----------
  // 「止めるのは日付タイマーだけではない。客の歩行・食事・退店、店員の往復、行列、すべて止める」
  // という指示への対応。setTimeoutは止めて残り時間を覚えておき、CSSトランジション中の客も
  // その場でピン留めする(見た目が一瞬で目的地へワープしてしまわないよう、計算上の現在地を読み取って
  // 固定する)。再開時は同じ目的地へ向けて動きを作り直す(中断した瞬間の正確な残り時間の再現はしていない。
  // 距離から所要時間を作り直す簡易措置。プロトタイプの検証用途としては十分と判断した)。
  function pinActor(a) {
    if (a.gone || !stage) return;
    // v35: left/topはpx直書きになったので、遷移中の実レイアウト値(px)をそのまま固定すればよい。
    // getComputedStyleのleft/topはカメラ層(.sv-camera)のscaleが掛かる前のレイアウト値なので
    // そのまま使える。以前のようにgetBoundingClientRect()から%へ逆算してはならない
    // (rectはscale後の値なので、倍率が1でないと倍率ぶんズレる。v35-2指示書 §1-3)。
    var cs = getComputedStyle(a.el);
    a.el.style.transitionDuration = "0s";
    a.el.style.left = parseFloat(cs.left) + "px";
    a.el.style.top = parseFloat(cs.top) + "px";
  }

  function resumeActor(a) {
    if (a.gone) return;
    a.el.style.transitionDuration = ""; // 一旦解除。moveが必要ならすぐ上書きする
    var cur = fromPx(parseFloat(a.el.style.left), parseFloat(a.el.style.top)); // v36-1: 逆変換は両軸から
    var curX = cur.x, curY = cur.y;
    var tgtX = parseFloat(a.el.dataset.x);
    var tgtY = a.tgtY != null ? a.tgtY : curY;
    if (isNaN(tgtX)) return;
    // 既に目的地(0.05マス≒2.4px。旧「舞台の0.5%」に相当する値)
    if (Math.abs(curX - tgtX) < 0.05 && Math.abs(curY - tgtY) < 0.05) return;
    move(a, tgtX, tgtY, Math.max(gm(RESUME_FLOOR_MIN), walkMs2(curX, curY, tgtX, tgtY)));
  }

  // v13-1: 客(actors)だけでなく厨房の店員(kitchenWorkers)も同じ「移動中の俳優」として
  // 一時停止・速度追随の対象にする(move()/later()を共用しているため形は同じ)。
  function movingActors() { return actors.concat(kitchenWorkers); }

  function freeze() {
    if (frozen) return;
    frozen = true;
    var now = Date.now();
    timers.forEach(function (rec) {
      if (!rec.id) return;
      clearTimeout(rec.id);
      rec.remaining = Math.max(0, rec.remaining - (now - rec.startedAt));
      rec.id = null;
    });
    movingActors().forEach(pinActor);
    syncSpeed(); // stage の .paused クラスを更新(食事の弾みも止まる)
  }

  function unfreeze() {
    if (!frozen) return;
    frozen = false;
    timers.forEach(armTimer);
    movingActors().forEach(resumeActor);
    syncSpeed();
  }

  // ---------- v12-1: 速度を切り替えた瞬間、画面上の客の残り時間・移動を新しい速度に追随させる ----------
  // pause/resume(freeze/unfreeze)と同じ考え方(残り時間を覚えて作り直す)を、止めずにその場で行う。
  // timers.remaining は「現在の速度での実ms」を持っているので、旧速度/新速度の比率を掛け直すだけで
  // 正しい実msに変換できる。移動中の客はpinActor→resumeActorで、今いる位置から新しい尺で動き直す。
  function retime() {
    var ns = spd();
    if (ns === curSpd) return;
    var ratio = curSpd / ns; // 旧速度/新速度
    var now = Date.now();
    timers.forEach(function (rec) {
      if (rec.id) {
        clearTimeout(rec.id);
        rec.remaining = Math.max(0, rec.remaining - (now - rec.startedAt));
      }
      rec.remaining = Math.max(16, rec.remaining * ratio);
      if (!frozen) armTimer(rec);
    });
    if (!frozen) movingActors().forEach(function (a) { pinActor(a); resumeActor(a); });
    curSpd = ns;
  }

  // ---------- 静物(店の躯体・設備) ----------
  function has(id) { return state.equipment.indexOf(id) >= 0; }

  // v24(docs/指示書/v24_席の設備化とプレゼント演出_指示書.md §2-4、
  // docs/指示書/v24_追補_調査への回答と追加指示.md §2): カウンター席は物件の固定値ではなく
  // 持ち物(state.seats.counter)。counterSlotsは物件が持つ「置ける上限」(枠の数)、
  // counterは実際に描く丸椅子の数(所持数、上限で頭打ち)。テーブル側は既存のまま変更していない。
  // v32(§1-2/§3-2、懸念11): テーブル席+4の計算はここでは行わず、Scoring.tableSeats()を読むだけ
  // にした(以前はここに"has('table_seats')?4:0"という同じ式が別に書かれていた二重管理だった)。
  function seatCounts() {
    var p = window.Scoring.getProperty(state);
    if (!p) return { counter: 0, counterSlots: 0, table: 0 };
    var owned = (state.seats && state.seats.counter) || 0;
    return {
      counter: Math.min(p.counterSlots, owned),
      counterSlots: p.counterSlots,
      table: Math.min(GEO.drawMaxTable, window.Scoring.tableSeats(state))
    };
  }

  // v32: idとcategoryから直接img/配下のパスを作って画像ノードを返す(v31のwindow.AssetImage.node()
  // はデータ定義(emoji/img)を持つ"def"を前提にしているため、店内固有の小物(丼・表情・家具)には
  // 疑似的なdefを作って渡す。読み込み失敗時のフォールバックもAssetImage側の仕組みがそのまま効く)。
  // idがnull/undefinedのときは絵が用意されていないものとして扱い、最初から絵文字のみを返す
  // (架空のファイル名を作って毎回読み込み失敗させない)。
  function stageDef(id, emojiFallback) {
    return id ? { img: "stage/" + id, emoji: emojiFallback, name: "" } : { emoji: emojiFallback, name: "" };
  }

  // 立ち物の表 PROPS はファイル冒頭(GEO の直前。GEO が停止点を表から導くため)。
  function propFontPx(p) {
    // 1em 角に contain → キャンバス高 = 1em、実体の高さ = 1em × ink.h/H、実体の幅 = 1em × ink.w/H
    if (p.widthCells) return p.widthCells * TW * p.H / p.ink.w;
    return p.heightCells * CELL * p.H / p.ink.h;
  }
  // 立ち物の要素(.sv-prop: 足元アンカー、img は display:block で要素の高さ=絵の高さ)。placeAt(el, cell.x, cell.y) で置く。
  // v48-2d(§71): flip は .flip クラス(CSS が scaleX(-1) を足元アンカーの後ろに掛ける。客と同じ)。
  // baseY は CSS 変数 --sv-base(px)に書き、CSS の translate が「下端」ではなく「接地線」を足元に合わせる。
  function propNode(id, emojiFallback) {
    var p = PROPS[id];
    var el = block("sv-prop sv-prop-" + id + (p.flip ? " flip" : ""), {}, [AI.node(stageDef(id, emojiFallback))]);
    var fontPx = propFontPx(p);
    el.style.fontSize = fontPx + "px";
    if (p.baseY != null) el.style.setProperty("--sv-base", (fontPx * (1 - p.baseY)) + "px");
    return el;
  }
  // v48-4a(§72): 立ち物の要素は id で持つ(propEls)。動かすときは ensureBuilt で組み直さず(客・従業員・タイマーが消える)、
  // この要素を placeAt し直す。data-prop はタップで「何を触ったか」を知るための印(onPointerDown が読む)。
  var propEls = {};
  // 停止点・枠に付いて動く要素(購入設備 big_pot/noodle_boiler/extra_boiler)。at() が今の置き場所を返す
  var anchored = [];
  function placeProp(id, emojiFallback) {
    var c = propCell(id);
    var el = placeAt(propNode(id, emojiFallback), c.x, c.y);
    el.dataset.prop = id;
    propEls[id] = el;
    return el;
  }
  function placeAnchored(el, at) { var p = at(); placeAt(el, p.x, p.y); anchored.push({ el: el, at: at }); return el; }

  function block(cls, style, children) {
    return h("div", { className: cls, style: style }, children || []);
  }

  // 静物を(x,y)(マス)に置く。z-indexはrow(y)から自動計算する(zForRow、店の躯体・俳優共通)。
  // 要素はCSS側で translate(-50%,-100%)(足元=接地マスの下端中央)にアンカーされている前提。
  function placeAt(el, x, y) {
    el.style.left = toPxX(x, y) + "px"; // v36-1: 斜めでは左右の位置もyに依る
    el.style.top = toPxY(x, y) + "px";
    el.style.zIndex = zForRow(x, y);
    return el;
  }
  // v35-3(チェックポイント1の回答3): 俳優(客・店員)は行の重なり順(z=row)を本体(.sv-body)だけに
  // 付け、根(.sv-cust/.sv-staff)にはz-indexもtransformも持たせない(持たせると根が
  // スタッキング文脈になり、子の丼・吹き出しが部屋の物より手前へ出られない)。
  // 丼・吹き出し・評判ポップは「部屋に置かれた物」ではなく「客についた表示」なので常に手前
  // (css/style.cssの .sv-bowl/.sv-bubble/.sv-rep-pop の z-index)。
  function setActorZ(el, x, y) {
    el.style.zIndex = "";
    var body = el.querySelector(".sv-body");
    if (body) body.style.zIndex = zForRow(x, y);
  }

  // v36-1: 部品の面を菱形の辺から作る。根(.sv-piece、幅TW・高さH、足元=マスの中心)の座標系で、
  // マスの菱形の頂点は 上(TW/2,H-TH/2) 右(TW,H) 下(TW/2,H+TH/2) 左(0,H)。見えるのは手前側の2辺
  // (左→下: 奥壁・カウンターの前板 / 下→右: 側壁の面)を高さHだけ上へ押し出した平行四辺形と、
  // カウンターの天板(菱形をHだけ持ち上げたもの)。面はclip-pathのpolygonで切る(仮の色板)。
  function isoFaces(piece, sym, H, variant) {
    var w2 = TW / 2, h2 = TH / 2;
    // v48-5c(§75): 腰壁の面は clip-path の色板ではなく、**32×48 の矩形を skewY で平行四辺形にした要素**に板壁の絵を貼る。
    // 矩形の背景は transform ごと歪むので、横板の線と笠木が辺(傾き h2/w2=0.5、26.57°)と平行になる。
    // clip-path のまま背景を貼ると、絵は 64×64 の箱に水平に敷かれて辺と平行にならない(v48-5c 調査 1-1)。
    // 幅は w2+1 で右隣の面に 1px 重ねる(倍率 0.95/1.5・DPR2 の小数 px で継ぎ目が透けないように。床の +2/+1 と同じ考え)。
    // front(手前左の辺): 矩形 (0,0)〜(w2,H) を +skew → 頂点 (0,0)(w2,h2)(w2,H+h2)(0,H) = back 面の平行四辺形。
    // right(手前右の辺): 矩形 (w2,h2)〜(TW,H+h2) を −skew → 頂点 (w2,h2)(TW,0)(TW,H)(w2,H+h2) = side 面の平行四辺形。
    var skewDeg = Math.atan2(h2, w2) * 180 / Math.PI;
    function lowWall(dir, v) {
      var el = block("sv-face sv-face-lowwall" + (v ? " " + v : ""), {
        left: (dir === "front" ? 0 : w2) + "px", top: (dir === "front" ? 0 : h2) + "px", width: (w2 + 1) + "px", height: H + "px"
      });
      el.style.transformOrigin = "0 0";
      el.style.transform = "skewY(" + (dir === "front" ? skewDeg : -skewDeg) + "deg)";
      piece.appendChild(el);
    }
    function face(cls, top, height, pts) {
      var el = block("sv-face " + cls, { left: "0px", top: top + "px", width: TW + "px", height: height + "px" });
      el.style.clipPath = "polygon(" + pts.map(function (p) { return p[0] + "px " + p[1] + "px"; }).join(",") + ")";
      piece.appendChild(el);
    }
    // 面の座標は「根の上端を0とし、下へ正」。根の高さはH、足元(マス中心)は y=H。
    // back面(左→下の辺): 奥壁・角の立面、カウンターの前板
    function back(cls) { face(cls, 0, H + h2, [[0, H], [w2, H + h2], [w2, h2], [0, 0]]); }
    // side面(下→右の辺): 側壁・角・入口の立面、カウンターの右端の側板
    function side(cls) { face(cls, 0, H + h2, [[w2, H + h2], [TW, H], [TW, 0], [w2, h2]]); }
    // 天板: 菱形をHだけ持ち上げたもの
    function top(cls) { face(cls, -h2, TH, [[w2, 0], [TW, h2], [w2, TH], [0, h2]]); }
    switch (sym) {
      case "#": back("sv-face-wall"); break;
      case "L": back("sv-face-wall"); side("sv-face-wall-side"); break;
      case "R": back("sv-face-wall"); break;      // v36-2: 右角は奥壁の面だけ(col13側の面は外面=描かない。v48-5 までは col11)
      case "l": side("sv-face-wall-side"); break;  // v36-2: r(col13。v48-5 までは col11)は部品なし(手前側の壁は描かない)
      // v48-2c: 入口 D はここでは作らない(v36-2〜v48-2b は back 面1枚の赤い色板だった)。
      // 絵(img/stage/entrance.webp)を立ち物として placeAt で置く(buildScenery の「入口」参照)
      case "(": case "=": back("sv-face-counter-front"); top("sv-face-counter-top"); break;
      case ")": back("sv-face-counter-front"); side("sv-face-counter-end"); top("sv-face-counter-top"); break;
      // v36-3 町: 建物・塀は箱(正面=back面、右側面=side面、屋根=top)。隣り合うマスの重なりは奥行き順の描画で隠れる
      // v48-5b(§74): 店の正面の腰壁(1マス=48px、側壁と同じ色)。front=手前左の辺(マスの y+0.5 の辺=row9/row10 の境)の外側の面、
      // right=手前右の辺(col13 の x+1 の辺)の外側の面。v36-2 で「外側の面はプレイヤーに背を向けて店の中を隠すだけ」と描かなかった辺に、
      // 客(60px)より低い腰壁として立てる。表の記号ではなく buildScenery が GEO.door を見て入口の列だけ切る
      // v48-5c: 色板 back/side(sv-face-wall-side)から、板壁の絵を貼った skew の面へ。variant は窓の種類(buildScenery の lowWallVariant)
      case "front": lowWall("front", variant); break;
      case "right": lowWall("right", variant); break;
      case "N": back("sv-face-bldg"); side("sv-face-bldg-side"); top("sv-face-roof"); break;
      case "F": back("sv-face-fence"); side("sv-face-fence-side"); top("sv-face-fence-top"); break;
      case "B": back("sv-face-far"); side("sv-face-far-side"); top("sv-face-far-roof"); break;
    }
  }

  function buildScenery() {
    window.UI.clear(stage);
    seats = [];
    actors = [];
    staffActors = [];
    queue = [];
    propEls = {}; anchored = []; placing = null; // v48-4a: 要素ごと消えるので参照と選択も捨てる
    refreshGeo();                                 // v48-4a: state.props を反映(読み込み直後・組み直しのたび)

    var counts = seatCounts();
    var room = roomDef();

    // v35: カメラ層。舞台(.shop-stage=クリップ枠)自身にはtransformをかけない(枠ごと動いてしまう。
    // v35-2指示書 §1-2)。以後の床・壁・什器・actorLayerはすべてこの層の子にする。
    cameraEl = block("sv-camera", {});
    // v35-3(§2): 人物系の大きさの基準(客の1em)。PERSON_HEIGHT_CELLSから作る(CSSには書かない)
    cameraEl.style.fontSize = custFontPx() + "px";
    // v36-2: ユーザーがカメラを動かした後に舞台を組み直しても(席の購入・雇用・設備購入)初期表示へ戻さない。
    // 限界に収め直すだけ(watchHudと同じ規則)。組み直しのたびに拡大が解除される実害があった
    if (camTouched) clampCamera(); else fitCamera();
    applyCamera();
    stage.appendChild(cameraEl);
    watchHud();

    // 床と躯体を部屋の表(ROOMS)のとおりに敷く。
    // 記号→床のクラス(壁マスには床を敷かない。壁の絵が接地マスごと覆う前提<素材仕様§3-2>)。
    // v35-2 の第2段階は仮タイル(色板+薄い境界線)で、敷き詰め・区画・「カウンターが1本の台に
    // 通るか」を目で判定するのが目的だった。区画ごとの色分け(wood-s/wood-t)もそこで廃止し、
    // 木目とタイルの2種にした。
    // **v48-2b(§69): その色板を本素材の画像に差し替えた**(木目 shop_wood.webp /
    // 厨房 shop_tile_cream.webp・shop_tile_mint.webp の市松)。当てているのは CSS 側で、
    // ここは記号→クラスの対応を持つだけ。
    // v35-4 が用意した floor_wood.webp / floor_tile.webp は**一度も使われないまま**
    // (v36-1 で床が菱形になった時点で 512×512 の正方形タイルが合わなくなった。§66-7)
    // v48-2b で削除した。
    var FLOOR_CLS = {
      "K": "tile", "S": "wood", "A": "wood", "T": "wood", "(": "tile", "=": "tile", ")": "tile", "D": "wood",
      "P": "tile", // v48-5(§73): カウンターの行の隙間。厨房の市松を続ける(部品なし・機器は置けない)
      // v48-1(§2-4、v47-lot §66-5 の部品をそのまま): **壁のマスにも足元の地面を敷く。**
      // v36-2 以来「壁マスには床を敷かない(壁の絵が接地マスごと覆う前提)」だったが、その前提が
      // 成り立つのは**絵のある壁**だけだった。手前側の壁(col13 の r。v48-5 までは col11)は「外側の面はプレイヤーに
      // 背を向けて店の中を隠すだけ」という理由で**部品を描いていない**ので、床も部品も無い
      // 1マス幅の穴が右の縁に v36-2 からずっと開いていた。v46 までは右隣の塀(0.5マス)がその穴の
      // 前に立って隠していただけで、v48-1 で右隣を撤去すると黒い筋として露出する。
      // l/L/#/R は絵のある壁なのでこの地面は見えない(敷いても無害)。見えるのは r の列だけ。
      "l": "base", "r": "base", "L": "base", "#": "base", "R": "base"
    };
    // v36-3: 町の記号→地面の色クラスと、高さのある部品 [面の色クラス, 高さ(マス)]
    // v48-1: 敷地の記号を足した。**門 O は地面だけで部品を持たない**(フェンスの切れ目そのもの)。
    // 地面は道 S と同じ色にして、門をくぐる道が1本につながって見えるようにする。
    // **フェンス F のマスにも地面(土)を敷く**(上と同じ理由。0.5マスの帯では足元が隠れない)。
    var TOWN_FLOOR = {
      "W": "walk", "C": "road", "B": "lot",
      "T": "dirt", "G": "grass", "S": "path", "O": "path", "F": "dirt", "E": "next"
    };
    // v48-1: 左隣の建物 N は撤去したので凡例ごと消した(死んだ記号を残さない)。
    // フェンス F(0.5マス)は v36-3 の右隣の塀と同じ部品・同じ CSS をそのまま使う。
    var TOWN_PIECE = { "F": ["fence", 0.5], "B": ["far", 1.5] };
    // v48-2a(§68-8): **土だけ絵を3種に散らす。**
    // 1枚の絵を全マスに敷くと、寄ったときに斑が周期的に並んで見えた(§3-1 の目視で実測)。
    // 3枚は**平均色が同じで模様だけが違う**ので、色の判定(§67-6)はどれで測っても変わらない。
    //
    // **どの種になるかは、そのマスの col と row だけで決まる。**
    // 状態も乱数も時刻も使わない——舞台は設備の購入や雇用のたびに組み直される(ensureBuilt)ので、
    // 乱数で選ぶと**組み直すたびに地面の模様が変わってしまう**。col/row だけの式なら、
    // 何度組み直しても同じ絵が同じマスに出る。
    //
    // 剰余は**負の側で 0 以上へ正規化する**。敷地の表は col0=-8, row0=-8 から始まるので、
    // col も row も負になる。JS の % は負の被除数に対して負を返す(-1 % 3 === -1)ため、
    // 正規化しないと variant が 0 や負になり、クラス名が存在しないものになる。
    //
    // **これは見た目だけの分岐。** 記号は T のままで TOWN_FLOOR も変えていない。
    // 判定・経路・当たり判定は "dirt" かどうかだけを見ており、1/2/3 の区別は持ち込まない
    // (要素には土台の sv-tile-dirt を必ず付け、その上に絵の sv-tile-dirt-N を足すだけ)。
    var DIRT_VARIANTS = 3;
    function dirtVariant(col, row) {
      var m = (col * 7 + row * 13) % DIRT_VARIANTS;
      if (m < 0) m += DIRT_VARIANTS;
      return m + 1;
    }
    // v48-2b(§69-2): **厨房の床の市松。** これは差し替えではなく**新設**——
    // v35-4 の floor_tile.webp は「生成りとミントの市松」を**絵の中に**持っていたが、
    // その画像は v36-1 で床が菱形になったときから**どこからも参照されていない**(§66-7)。
    // 以来この床は、その絵から採った色1色のべた塗りだった。ここで初めて市松が実装になる。
    //
    // dirtVariant と同じ作法: **マスの座標だけ**で決め、状態も乱数も時刻も使わない
    // (舞台は設備の購入や雇用のたびに組み直される。乱数だとそのたびに市松がずれる)。
    // 剰余の正規化も揃えてある——店の表は col0=0 から始まるので**いまは負にならない**が、
    // 敷地(col0=-8)のように後から負の座標へ広がったとき、ここだけ作法が違うと踏む。
    // a=生成り / b=ミント。カウンターのマス ( = ) も "tile" なので市松に含まれる(意図どおり)。
    function tileVariant(col, row) {
      var m = (col + row) % 2;
      if (m < 0) m += 2;
      return m === 0 ? "a" : "b";
    }
    // 記号→高さのある部品 [色クラス, 高さ(マス)]。カウンターは1.2マス
    // (素材仕様§3-3「台の絵は下1マス強」。1.5マスで作ったら、奥のrow2に立つ店員が
    // 頭しか見えなくなるのを実際のスクリーンショットで確認し、1マス強へ直した)。
    // v35-4(§46): 壁の高さの規則——**側壁の帯を作る部品(l/r)は1マス。上端を担う角(L/R)と、
    // 開口や意匠のように高さを持たせたい部品(入口Dなど)は2マス以上でよい。** 描画順が奥→手前で
    // ある限り、高い部品は必ず1つ奥の部品より後に描かれるので手前に出る(部品ごとの例外のzは不要)。
    // 側壁の帯の部品まで2マスにすると、入口が上下両方の隣(row4・row6)と重なり、どちらの描画順でも
    // 片方に半分隠される(実測で踏んだ)。奥壁(#)は横に並ぶだけなので2マスのまま。
    // v36-2(§1): 手前側の壁は描かない。根拠: 斜めの投影で見えるのは「奥の2辺(row0側・col0側)の内側の面」と
    // 「手前の2辺(row末尾側・col13側)の外側の面」で、外側の面はプレイヤーに背を向けて店の中を隠すだけ。
    // よって col13(v48-5 までは col11)の側壁 r は部品を持たず(表には厚みとして残す)、角 R は奥壁の面だけを持つ。
    // v36-2(§2): 高さの単位は従来どおりCELL=48pxだが、斜めでは行の奥行き差が TH/2=16px しかないため
    // 「立っている物の高さ÷16px」がそのまま隠す行数になる。
    //   カウンター 0.6マス=28.8px → 1行奥の人物(60px)の足元12.8pxだけ隠す(2行奥は隠さない)。
    //   1.2マスのままだと57.6px → 1行奥の人物を41.6px隠して頭と丼だけになる(v36-1で実測)。
    //   奥壁 2マス=96px → 6行ぶんだが奥壁の向こうには何も無い。側壁 1マス=48px(最奥のzなので何も隠さない)。
    // v48-2c: 入口 D は部品(色板)ではなく立ち物の絵になった(PROPS.entrance)。
    // v48-2d(§71): 表の記号 D は「壁の切れ目」の意味だけ(床は FLOOR_CLS で A と同じ木目)。**描画の座標源にはしない**
    // ——入口の絵は PROPS.entrance.cell、客の経由点は GEO.door(表から導く)。
    var PIECE_CLS = {
      "L": ["wall-corner", 2], "#": ["wall-mid", 2], "R": ["wall-corner", 2],
      "l": ["wall-side", 1],
      "(": ["counter-l", 0.6], "=": ["counter-mid", 0.6], ")": ["counter-r", 0.6]
    };
    // v35-3(§1、§44-5の「許容」を解消): 重なりの規則は1行——
    // 「壁(側壁・奥壁)は部屋の縁に沿って連続する1枚の面なので手前の行を隠さない(zは部屋の最奥で固定)／
    //   台(カウンター)は部屋の中に置かれた物なので奥の行を隠す(z=row)」。
    // 壁を行ごとに切ってあるのは描画の都合にすぎず、row6の側壁の上半分がrow5の入口や客を覆うのは
    // 「手前の壁の陰」ではなく単なる描画順の事故だった(v35-3調査報告 §1)。
    // v48-2c: 入口(暖簾)はこの規則から外した——立ち物として z=row を持つ(店の中にいる客より手前、
    // 歩道側にいる客より奥。「くぐる」が見える)。
    var WALL_SYMS = "L#Rlr";
    var WALL_Z = zForRow(-1, 0); // 床(z無し=0)より上、部屋の中の何(奥行き0以上)より奥
    // v36-1: 床タイルは菱形(CSSのclip-path)。位置は変換関数の戻り値(マスの中心)に
    // translate(-50%,-50%)で中心合わせ。横2px・縦1px大きくして隣と重ねる(§46-4の小数pxの隙間は斜めでも起きる)
    for (var row = 0; row < room.rows; row++) {
      for (var col = 0; col < room.cols; col++) {
        var sym = room.map[row].charAt(col);
        var fcls = FLOOR_CLS[sym];
        if (fcls) {
          // v48-2b(§69-2): 厨房の床だけ、土台のクラスに市松の面(sv-tile-tile-a/-b)を足す。
          // 土台の sv-tile-tile は必ず付いたままなので、"tile かどうか" を見る側は何も変わらない
          // (地面の土を3種に散らしたときとまったく同じ作り。§68-8)
          var fclsName = "sv-tile sv-tile-" + fcls +
            (fcls === "tile" ? " sv-tile-tile-" + tileVariant(col, row) : "");
          cameraEl.appendChild(block(fclsName, {
            left: toPxX(col + 0.5, row + 0.5) + "px", top: toPxY(col + 0.5, row + 0.5) + "px",
            width: (TW + 2) + "px", height: (TH + 1) + "px"
          }));
        }
      }
    }
    // 高さのある部品(壁・カウンター)は床の後に、**奥から手前へ(奥行き x+y の昇順)**描く(§46-3の規則を
    // 斜めに一般化)。壁は全部同じz(WALL_Z)なので重なり順はDOMの追加順で決まる(§43-5と同じ性質)。
    // v36-1: 各部品の根は placeAt(マスの中心に足元)で置き、面(壁の立面・カウンターの天板と前板)は
    // 根の子として isoFaces() が菱形の辺から作る。斜めでは隣り合う壁の面は横に並ぶだけで重ならない。
    var pieces = [];
    for (var row = 0; row < room.rows; row++) {
      for (var col = 0; col < room.cols; col++) {
        var sym = room.map[row].charAt(col);
        if (PIECE_CLS[sym]) pieces.push({ sym: sym, col: col, row: row, cls: PIECE_CLS[sym] });
      }
    }
    // v36-3: 町(ROOMS.town)。地面は店の床と同じ菱形、建物・塀は店の什器と同じ面の作り(isoFaces)。
    // 建物のzは奥行き(z=col+row)=部屋の中の物と同じ扱い(店の壁のように最奥固定にはしない。右隣は
    // 物理的に店より手前にあるので、隠すものは隠す。その範囲は表のコメントに計算してある)
    if (room.town) {
      for (var tr = 0; tr < room.town.map.length; tr++) {
        for (var tc = 0; tc < room.town.map[tr].length; tc++) {
          var tsym = room.town.map[tr].charAt(tc);
          var gcol = room.town.col0 + tc, grow = room.town.row0 + tr;
          if (TOWN_FLOOR[tsym]) {
            // v48-2a(§68-8): 土だけ、土台のクラスに絵の種(sv-tile-dirt-1/2/3)を足す。
            // 土台の sv-tile-dirt は必ず付いたままなので、"dirt かどうか" を見る側は何も変わらない
            var tcls = TOWN_FLOOR[tsym];
            var tclsName = "sv-tile sv-tile-" + tcls +
              (tcls === "dirt" ? " sv-tile-dirt-" + dirtVariant(gcol, grow) : "");
            cameraEl.appendChild(block(tclsName, {
              left: toPxX(gcol + 0.5, grow + 0.5) + "px", top: toPxY(gcol + 0.5, grow + 0.5) + "px",
              width: (TW + 2) + "px", height: (TH + 1) + "px"
            }));
          }
          if (TOWN_PIECE[tsym]) pieces.push({ sym: tsym, col: gcol, row: grow, cls: TOWN_PIECE[tsym], town: true });
        }
      }
    }
    pieces.sort(function (a, b) { return (a.col + a.row) - (b.col + b.row); });
    pieces.forEach(function (p) {
      var pcls = p.cls;
      var piece = block("sv-piece sv-piece-" + pcls[0], { width: TW + "px", height: (pcls[1] * CELL) + "px" });
      isoFaces(piece, p.sym, pcls[1] * CELL);
      placeAt(piece, p.col + 0.5, p.row + 0.5); // 足元(根の下端中央)=マスの菱形の中心
      if (!p.town && WALL_SYMS.indexOf(p.sym) >= 0) piece.style.zIndex = WALL_Z;
      cameraEl.appendChild(piece);
    });
    // v48-5b(§74): 店の正面の腰壁(手前左の辺 row9 の全列と、手前右の辺 col13 の客席側 rows4〜9)。1マス=48px、側壁と同じ色。
    // 表の記号は使わない(ROOMS は触らない)——最終行・最終列と GEO.door から起こす。入口の列(doorCols)だけ切る。
    // z: 壁は「奥の壁」の WALL_Z 固定ではなく、**手前の辺に立つ物**として行から出す。
    //   zForRow(col+0.5, rows−1.1) = row9 の中心より 0.6 行奥の値(col5 なら 250 相当、col6 で 254、col4 で 233)。
    //   これで 店内 row8 の客(z 240)は壁の奥、前庭 row10 の客(z 260)は壁の手前、入口の絵(5.5,10.0 → z 255)は隣の壁(col6: 254)より手前
    //   ——客が敷居をまたぐ前後(§70-3、z 256→248)の前後関係と両立する(v48-5b 調査 1-2 の表)。
    //   rows−1.0 だと col6 の壁が 255 で入口と同点になり DOM 順に頼ることになるので 0.1 奥にした(実測)。
    //   手前右の辺は placeAt の既定(zForRow(13.5, row+0.5))で、col12 の物より +10 手前。外に何も無いので衝突しない。
    var cut = doorCols();
    for (var fc = 0; fc < room.cols; fc++) {
      if (cut.indexOf(fc) >= 0) continue;
      var front = block("sv-piece sv-piece-front", { width: TW + "px", height: CELL + "px" });
      isoFaces(front, "front", CELL, lowWallVariant("front", fc, room.rows - 1));
      placeAt(front, fc + 0.5, room.rows - 0.5);
      front.style.zIndex = zForRow(fc + 0.5, room.rows - 1.1);
      cameraEl.appendChild(front);
    }
    for (var rr = Math.floor(GEO.counterSeatRow); rr < room.rows; rr++) {
      var right = block("sv-piece sv-piece-right", { width: TW + "px", height: CELL + "px" });
      isoFaces(right, "right", CELL, lowWallVariant("right", room.cols - 1, rr));
      placeAt(right, room.cols - 0.5, rr + 0.5);
      cameraEl.appendChild(right);
    }
    // v48-2c(§70): 入口(暖簾と格子戸の絵)。幅は1マス(TW)ちょうど、高さは絵の縦横比なり。
    // z は他の立ち物と同じ zForRow(壁の WALL_Z 固定ではない): 店の中にいる客は暖簾の奥、前庭にいる客は暖簾の手前に描かれる。
    // v48-2d(§71): 足元は PROPS.entrance.cell = **店の正面の辺の中点 (5.5, 10.0)**(表の D からは取らない。§70-1 のずれの再発防止)。
    // 絵の接地線(baseY)をこの点に合わせるので、暖簾の柱の底が床と歩道の境目の線にぴったり乗る。
    // z = zForRow(5.5, 10.0) = 255: 客は敷居(y=10.0)をまたいだ瞬間に暖簾の奥へ回る(前庭 y=10.5 は z 260 で手前)。
    cameraEl.appendChild(placeProp("entrance", "🚪"));

    // 電灯・ダクト・壁の案内・店名看板は奥壁の面(row0の壁が上へ伸びた部分=部屋の外の負のrow)に
    // 掛ける。yが負のままzForRow()を通すと壁(row0)より奥のzになってしまうため、
    // 「壁に掛かっている物は壁のすぐ手前」としてzだけrow0.6相当を明示的に与える。
    var wallZ = zForRow(0, 0.6);
    var lampSpots = has("bright_light") ? [{ x: 3.0, y: -0.1 }, { x: 6.5, y: -0.3 }, { x: 9.0, y: -0.1 }] : [{ x: 6.5, y: -0.3 }];
    lampSpots.forEach(function (spot) {
      var el = block("sv-lamp", {}, [AI.node(stageDef(null, "💡"))]);
      placeAt(el, spot.x, spot.y);
      el.style.zIndex = wallZ;
      cameraEl.appendChild(el);
    });
    if (has("exhaust")) {
      var ductEl = block("sv-duct", {}, [AI.node(U.findById(EQUIP, "exhaust"))]);
      placeAt(ductEl, 1.5, -0.2);
      ductEl.style.zIndex = wallZ;
      cameraEl.appendChild(ductEl);
    }

    // 厨房設備(K帯の奥の壁沿い)。
    // v48-2c(§70): 常設の寸胴(v35〜v48-2b は絵文字🍥)と茹で麺機(v48-2b まで常設の絵は無かった)を本素材にした。
    // 従業員は設備の**奥(背中側)**の1行に立って作業して見える(🍥のときと同じ置き方。同じマスに立たせると従業員が設備に重なる)。
    // 高さは2つとも同じ(PROPS の heightCells): 上端が奥に立つ従業員の胸の高さで、顔を隠さない。
    // v48-2d(§71): 足元は PROPS の cell、停止点 GEO.soup / GEO.noodle は表の work から導く(この行は表を写すだけ)。
    // 茹で麺機は左奥 (4.5, 2.5) に移し、左右反転して正面をカウンター側(+y、画面左下)へ向けた。
    cameraEl.appendChild(placeProp("stockpot", "🍥"));
    cameraEl.appendChild(placeProp("noodle_boiler", "♨️"));
    // 既製品(big_pot/noodle_boiler/extra_boiler)は v31 の img/equipment/(256×256)を
    // v35 の1マス幅(48px)の規約のまま置く(v48-2c でも変えない。指示書 §2-2)。
    // v48-4a: 置き場所は関数で持つ(停止点に付いて動く。moveProp が placeAnchored の at() を呼び直す)
    var kit = [];
    if (has("big_pot")) kit.push({ at: function () { return GEO.soup; }, def: U.findById(EQUIP, "big_pot") });
    if (has("noodle_boiler")) kit.push({ at: function () { return GEO.noodle; }, def: U.findById(EQUIP, "noodle_boiler") });
    if (has("extra_boiler")) kit.push({ at: function () { return { x: GEO.soup.x + 1, y: GEO.soup.y }; }, def: U.findById(EQUIP, "extra_boiler") });
    kit.forEach(function (k) {
      cameraEl.appendChild(placeAnchored(block("sv-kit-item", {}, [AI.node(k.def)]), k.at));
    });
    // v13-1/v14-5: 盛り付け済みでホールが運ぶのを待っている丼が積まれて見える場所。
    // v35: カウンターの天板の上(受け渡し口=GEO.plateの手前のC帯)に置く。台の上に載る物なので、
    // zは台(row3)より手前を明示する(yを台の見た目の上面<row3.1>に置くとzForRowでは台より奥になるため)。
    orderPileEl = block("sv-order-pile", {});
    placeAt(orderPileEl, GEO.plate.x, 3.1);
    orderPileEl.style.zIndex = zForRow(GEO.plate.x, 3.6);
    cameraEl.appendChild(orderPileEl);
    if (has("multilingual")) {
      var signEl = block("sv-wall-sign", {}, [AI.node(U.findById(EQUIP, "multilingual"))]);
      placeAt(signEl, 5.0, -0.25);
      signEl.style.zIndex = wallZ;
      cameraEl.appendChild(signEl);
    }

    // カウンター本体はもう1枚絵では描かない(部屋の表の (==…==) が左端/中間/右端の部品として
    // 敷かれている。§43-8の「独立した箱を引き伸ばす/継ぎ足す」問題の解消)。

    // カウンター席の丸椅子。
    // v24(指示書§3-5、追補§2): 枠(物件のcounterSlots)を先に確保し、所持している席
    // (counts.counter)だけを左から順に埋める。空き枠には席を描かない。
    // v35: 枠はS行(counterSeatRow)のcol1から1マスに1脚(旧isoSpreadの等間隔割り付けは廃止)。
    // 席の枠が部屋の内側の幅を超える物件は今回未対応(ROOMSのコメント参照)——超える分は描かない。
    // §3-3: 前回描画時より所持数が増えていたら、増えた席にだけポップ用のクラス+✨を付ける。
    var maxSlots = Math.min(counts.counterSlots, room.cols - 2);
    var isFirstBuild = prevDrawnCounter == null;
    var rm = reducedMotionSV();
    var popIndex = 0;
    for (var si = 0; si < Math.min(counts.counter, maxSlots); si++) {
      var sx = 1.5 + si, sy = GEO.counterSeatRow;
      var isNew = !isFirstBuild && si >= prevDrawnCounter && !rm;
      var stoolEl = block("sv-stool" + (isNew ? " sv-stool-pop" : ""), {}, [AI.node(stageDef("stool", "🪑"))]);
      placeAt(stoolEl, sx, sy);
      if (isNew) {
        var delay = (popIndex * STOOL_POP_STAGGER_MS) + "ms";
        stoolEl.style.animationDelay = delay;
        var sparkleEl = h("span", { className: "sv-stool-sparkle emoji-font", text: "✨" });
        sparkleEl.style.animationDelay = delay;
        stoolEl.appendChild(sparkleEl);
        popIndex++;
      }
      cameraEl.appendChild(stoolEl);
      seats.push({ x: sx, y: sy, kind: "counter", occupant: null });
    }
    prevDrawnCounter = counts.counter;

    // テーブル席。v32: v31のimg/equipment/table_seats.webp(卓+丸椅子2脚が1枚に描かれた絵)を
    // 1卓ぶんの代表表示として使う。1枚=2席として数える。
    // v35: 卓は2マス幅(96px)としてT帯の固定アンカー(GEO.tableAnchors)に置く。
    if (counts.table > 0) {
      var tableCount = Math.ceil(counts.table / 2);
      var tPts = GEO.tableAnchors.slice(0, tableCount);
      var tableDef = U.findById(EQUIP, "table_seats");
      var seatIdx = 0;
      tPts.forEach(function (pt) {
        var tEl = block("sv-table-img", {}, [AI.node(tableDef)]);
        placeAt(tEl, pt.x, pt.y);
        cameraEl.appendChild(tEl);
        for (var k = 0; k < 2 && seatIdx < counts.table; k++, seatIdx++) {
          seats.push({ x: pt.x + (k === 0 ? -0.5 : 0.5), y: pt.y + 0.2, kind: "table", occupant: null });
        }
      });
    }

    // レジの枠(入口の内側、A帯の左端 = GEO.ticket)。
    // v48-2c(§70): このマスは「1枠」。常設のレジ(register.webp)を置き、購入設備があれば
    // POSレジ > 券売機 > 常設のレジ の順で**1つだけ**描く(2つ並べない)。
    // POSレジは v35〜v48-2b は厨房 (4.5,2.5) の直値に置いていたが、レジは店に1台なのでこの枠へ移した。
    // 購入設備の絵は従来どおり 48px 角(.sv-kit-item / .sv-ticket)。
    var regEl = has("pos") ? block("sv-kit-item", {}, [AI.node(U.findById(EQUIP, "pos"))])
      : has("ticket_machine") ? block("sv-ticket", {}, [AI.node(U.findById(EQUIP, "ticket_machine"))])
      : propNode("register", "🧾");
    // v48-4a: 動かせるのは「枠」——POS・券売機が描かれていてもこの要素を register として持つ
    regEl.dataset.prop = "register";
    propEls.register = regEl;
    cameraEl.appendChild(placeAt(regEl, GEO.ticket.x, GEO.ticket.y));

    var prop = window.Scoring.getProperty(state);
    var signboardEl = block("sv-signboard", {}, [
      AI.node(prop || stageDef(null, "🏪")),
      h("span", { text: prop ? prop.name : "" })
    ]);
    placeAt(signboardEl, 8.0, -0.5); // 奥壁の面の右寄り
    signboardEl.style.zIndex = wallZ;
    cameraEl.appendChild(signboardEl);

    // v35(v35-2指示書 §1-6、§43-5の再発防止): 客・従業員を載せる層は、家具をすべて描き終えた
    // 「最後」に追加する。着席した客は丸椅子と同じマス(=zForRowが同じ整数)になるため、
    // z-index同点の重なりはDOM出現順で決まる——後に追加したactorLayer側(人物)が必ず上に来る。
    // masterではこの層を床の直後(家具より前)に追加しており、v33で「着席客が丸椅子の陰に隠れる」
    // 事故の原因になっていた(ブランチv33-34-iso-gridにだけ修正が入っていた)。
    actorLayer = block("sv-actors", {});
    cameraEl.appendChild(actorLayer);

    // v35-3(§4): ?grid=1 のときだけ、マスの境界線と col,row 番号を部屋に重ねる(目視判定の道具。
    // カメラ層の子なのでスクロール・ピンチでも部屋と一緒に動く。通常プレイには出ない)。
    if (gridDebug) {
      // v36-1: 升目も変換関数から作る(菱形)。SVGの多角形+番号を1枚に描く
      var NS = "http://www.w3.org/2000/svg";
      var rs = roomSize(1);
      var svg = document.createElementNS(NS, "svg");
      svg.setAttribute("class", "sv-grid");
      svg.setAttribute("width", rs.w); svg.setAttribute("height", rs.h);
      svg.style.top = (-roomRise()) + "px";
      // v48-1(§2-6、v47-lot §66-8 の部品をそのまま): 店の表だけでなく**敷地の外接矩形の全部**
      // (敷地・フェンス・門・歩道・車道・隣地も)に升目を出す。どのマスが何なのかを目で確かめられないと
      // この版の確認ができない。
      var ge = roomExtent();
      for (var gr = ge.rowMin; gr <= ge.rowMax; gr++) {
        for (var gc = ge.colMin; gc <= ge.colMax; gc++) {
          var pts = [[gc, gr], [gc + 1, gr], [gc + 1, gr + 1], [gc, gr + 1]].map(function (c) {
            return toPxX(c[0], c[1]) + "," + (toPxY(c[0], c[1]) + roomRise());
          }).join(" ");
          var poly = document.createElementNS(NS, "polygon");
          poly.setAttribute("points", pts);
          svg.appendChild(poly);
          var t = document.createElementNS(NS, "text");
          t.setAttribute("x", toPxX(gc + 0.5, gr + 0.5)); t.setAttribute("y", toPxY(gc + 0.5, gr + 0.5) + roomRise() + 3);
          t.textContent = gc + "," + gr;
          svg.appendChild(t);
        }
      }
      cameraEl.appendChild(svg);
    }

    stage.className = "shop-stage" + (has("bright_light") ? " bright" : "");

    buildStaff();
  }

  // v14-5: 店員の役割を「厨房」「ホール」に分ける(プレイヤーには選ばせない。既存の接客能力から
  // 自動で決める)。2人以上いれば接客(service)が最も高い1名をホール・残りを厨房、1人なら兼任。
  // 役割は既存の従業員能力(effectiveStat。「教える」の伸びも反映済み)を読むだけで、新しい設定項目・
  // 新しい数値は一切増やしていない。定位置(homeX/homeY)も役割ごとに分け、厨房は寸胴側、ホールは
  // 受け渡し口(GEO.plate)寄りに置く(1人兼任のときは厨房側の定位置のまま)。
  function assignRoles(workers) {
    if (workers.length >= 2) {
      var bestIdx = 0;
      for (var i = 1; i < workers.length; i++) {
        if (effectiveOf(workers[i], "service") > effectiveOf(workers[bestIdx], "service")) bestIdx = i;
      }
      workers.forEach(function (w, idx) { w.role = (idx === bestIdx) ? "hall" : "kitchen"; });
    } else {
      workers.forEach(function (w) { w.role = "both"; });
    }
  }

  function effectiveOf(w, key) {
    var bonus = state.staffState && state.staffState[w.id] && state.staffState[w.id].statBonus;
    return window.Scoring.effectiveStat(w.def, bonus, key);
  }

  // v13-1: 店員1人 = 厨房またはホールで働く1人ぶんの俳優(kitchenWorkers。名前はv13のまま、
  // 実際には両役割を含む)。移動はcustomerと同じmove()/later()を使うので、一時停止・速度追随は
  // movingActors()経由でそのまま効く。
  function buildStaff() {
    staffActors = [];
    kitchenWorkers = [];
    orderQueue = [];
    readyQueue = [];
    var workers = state.staffHired.map(function (id) {
      var def = window.Scoring.findStaffDef(state, id); // STEP6: スカウト勢も対象に含める
      return def ? { id: id, def: def } : null;
    }).filter(Boolean);
    assignRoles(workers);
    // v35: 厨房の定位置はK帯のrow2に横一列でspread(±2マス。1人なら基準点そのもの)
    var kitchenSpots = isoSpread(workers.filter(function (w) { return w.role !== "hall"; }).length,
      { x: GEO.kitchenHome.x - 2, y: GEO.kitchenHome.y }, { x: GEO.kitchenHome.x + 2, y: GEO.kitchenHome.y });
    var kIdx = 0;
    workers.forEach(function (w) {
      var home = w.role === "hall" ? GEO.hallHome : (kitchenSpots[kIdx++] || GEO.kitchenHome);
      // v37-4: ゆうただけ歩行2コマ。根に印クラス .walk を付け、CSS の反転(.sv-staff.walk.flip .sv-body)をこの1人に限る
      // (.flip クラス自体は move() が俳優の種類を問わず付けている。他の従業員は CSS が無いので反転しない)
      var useWalk = w.id === WALK_STAFF_ID;
      var el = h("div", { className: "sv-staff" + (useWalk ? " walk" : "") }, [
        h("span", { className: "sv-body" }, [AI.node(useWalk ? walkImgDef(w.def, 0, WALK_STAFF_FRAMES) : w.def)]),
        h("span", { className: "sv-bowl" }, [AI.node(stageDef("bowl", "🍜"))])
      ]);
      el.style.fontSize = staffFontEm() + "em"; // v35-3(§2): 客と同じ背丈になる倍率(定数1つから導出)
      placeAt(el, home.x, home.y);
      setActorZ(el, home.x, home.y);
      el.dataset.x = home.x;
      actorLayer.appendChild(el);
      w.el = el; w.gone = false; w.busy = false; w.homeX = home.x; w.homeY = home.y; w.curY = home.y;
      w.body = el.querySelector(".sv-body");
      w.walk = null; // v37-4: 歩行2コマの状態(客の a.walk と同じ形。ゆうた以外は null のまま=従来どおり)
      if (useWalk) {
        w.body.style.fontSize = staffWalkFontEm() + "em";
        w.walk = { frame: 0, key: "f0", back: false, def: w.def, acc: 0, last: null, frames: WALK_STAFF_FRAMES };
      }
      kitchenWorkers.push(w);
      staffActors.push(el);
    });
    renderReadyPile();
    dispatchOrders();
    syncSpeed();
  }

  // ---------- v13-1/v14-5: 厨房の作業動線(寸胴→茹で麺器→盛り付け→[受け渡し口]→客席→戻る) ----------
  // 「絵は計算を決めない」の指示どおり、ここは既に計算済みの値(客の入店タイミング=既存の週次客数を
  // 帯へ配分したスケジュール由来、traffic.targetInterval=Scoring.staffProcessingCapacity()由来の
  // Wと座席数から導出した目標間隔)を読むだけで、ここから週次計算(scoring.js)側へ書き戻すことは
  // 一切しない。v28-2(追補2§J)以降、従業員個人の能力(旧5能力)は絵の速度からは参照しない
  // (Wを決める新4能力と二重に効かせないため。assignRoles()の役割選定だけは既存のまま
  // effectiveOf()=旧5能力を使い続ける。触れない範囲)。
  //
  // v14-5: 役割を「厨房」(寸胴→茹で麺器→盛り付け→受け渡し口に置く)と「ホール」(受け渡し口の丼を
  // 取る→客席へ運ぶ→戻る)に分けた。1人だけの店は兼任(runSoloCycle。v13までと同じ、作って自分で
  // 運んで戻るの一続き)。厨房・ホールで別々に動くのは2人以上のときだけ(runKitchenCycle/runHallCycle、
  // orderQueue=厨房が未着手の注文/readyQueue=盛り付け済みでホール待ちの丼、の2段構え)。
  // v32(§37、指示書§3-3): カウンター席(kind==="counter")は受け渡し口のすぐそばという設定に
  // 合わせ、盛り付けた瞬間に直接提供する(ホールの客席までの往復を挟まない)。テーブル席
  // (kind==="table")は今までどおりホールが運ぶ。seats.kindを初めて読む箇所がここ。
  var KITCHEN_PILE_MAX = 6; // 積める丼アイコンの表示上限(それ以上は「+N」で表す)
  // v15-2: 「待機中(丼がまだ届いていない)」の我慢の限界。v14-5にあった60分の安全弁は
  // 「強制的に食べさせる」処理だったため、丼を受け取っていない客が満足顔で帰る不具合の原因に
  // なっていた(v15指示書 0番)。ここでは「食べ始めさせる」のではなく「怒って帰らせる」に統一する。
  // v16: 我慢の限界の実体(PATIENCE_BASE_MIN/TOL_MIN)は行列側と共有(ファイル冒頭で定義)。
  // 従業員0人(異常系)・注文ロストのときもここで必ず時間切れになり、無限に待ち続けることはない
  // (v14-5にあった「0人なら即座に食べ始める」特例は廃止済み——丼が無いのに食べ始めるのは、
  // 0人でも他の異常系でも同じく誤りのため)。

  // v14-5: 「厨房が遅い→受け渡し口に丼が無い」「ホールが足りない→受け渡し口に丼が積み上がる」と
  // 詰まっている場所によって絵が変わるようにするため、v13で入れた「丼の山」はホール側の詰まり
  // (=盛り付け済みで運ばれるのを待っているreadyQueue)を表すものとして位置づけ直した
  // (厨房側の未着手の注文=orderQueueには専用の絵を足していない。客が席で待ったままなのが
  // 「厨房が遅い」の見え方になる)。v32: カウンター客ぶんはここに積まれない(直接提供のため)。
  function renderReadyPile() {
    if (!orderPileEl) return;
    window.UI.clear(orderPileEl);
    var n = readyQueue.length;
    var shown = Math.min(n, KITCHEN_PILE_MAX);
    for (var i = 0; i < shown; i++) {
      orderPileEl.appendChild(h("span", { className: "sv-pile-bowl" }, [AI.node(stageDef("bowl", "🍜"))]));
    }
    if (n > KITCHEN_PILE_MAX) {
      orderPileEl.appendChild(h("span", { className: "sv-pile-more", text: "+" + (n - KITCHEN_PILE_MAX) }));
    }
  }

  // 客が入店した瞬間(=席へ向かい始めた瞬間)に「注文」を1件発生させる。手が空いている厨房担当が
  // いればすぐに掴む。全員手一杯なら(厨房側は絵を出さず)客が席で待ったままになる。
  // v14-5: 客の実体(actor)も持たせておき、配膳時に「まだその客がその席にいるか」を確認できるようにする。
  function placeOrder(seat, actor) {
    orderQueue.push({ id: ++orderSeq, seat: seat, actor: actor });
    dispatchOrders();
  }

  function dispatchOrders() {
    kitchenWorkers.forEach(function (w) {
      if (w.gone || w.busy) return;
      if (w.role === "hall") return; // ホール専任は厨房の注文を取らない
      if (!orderQueue.length) return;
      var order = orderQueue.shift();
      if (w.role === "both") runSoloCycle(w, order); else runKitchenCycle(w, order);
    });
    kitchenWorkers.forEach(function (w) {
      if (w.gone || w.busy || w.role !== "hall") return;
      if (!readyQueue.length) return;
      var ready = readyQueue.shift();
      renderReadyPile();
      runHallCycle(w, ready);
    });
  }

  // v28-2(指示書§4、追補2§J): 絵の配膳能力をWから導出する。
  // traffic.targetInterval(T、update()で算出。ゲーム分/杯)から、店全体で一律の速度係数
  // (pace)を作る。従業員個人の能力(旧5能力)は参照しない——その能力は既にW
  // (Scoring.staffProcessingCapacity())に入っており、絵の側でも掛けると同じ能力が二重に
  // 効いてしまうため(追補2§J後半)。
  function targetIntervalMin() { return traffic.targetInterval || WEEK_OPERATING_MIN; }

  // 現在地(fromX,fromY)からある地点(toX,toY)までの「pace=1のときの」移動ゲーム分(1x基準ms)。
  // v32: 斜め上視点では移動が斜めになるため、x・y両方の距離を合成する(旧版はxだけ・yだけを
  // 別々に足すマンハッタン距離に近い式だったが、斜め移動の実態に合わせ直線距離にした)。
  function legBaseMs(fromX, fromY, toX, toY) {
    return walkMs2(fromX, fromY, toX, toY);
  }

  // moveWorker()と同じ移動を、渡されたpaceで一律にスケールして実行する(CSS遷移の尺と
  // later()の待ち時間を必ず一致させるため、スケールはここで一度だけ行う)。
  function moveWorker(w, x, y, pace) {
    var fromX = parseFloat(w.el.dataset.x != null ? w.el.dataset.x : x);
    var fromY = w.curY != null ? w.curY : GEO.kitchenHome.y;
    var travelMs = legBaseMs(fromX, fromY, x, y) / (pace || 1);
    move(w, x, y, travelMs);
    w.curY = y;
    return travelMs;
  }

  // 客がまだその席で待っているときだけ、実際に食べ始めさせる(丼が届くまで食べない)。
  // 客が先に帰っていた(seat.occupantが入れ替わっている/空いている)場合は、その丼は
  // 静かに廃棄する(v15-3。作り直しのループは作らない——ここでは何もしないだけ)。
  // v16-1: 所持金・売上は「丼が客の席に置かれた瞬間」であるここで加算する(以前はfinishMeal、
  // つまり食べ終わった瞬間だった。待ちきれず帰った客は元々ここへ来ないので二重取りではないが、
  // 「食べ終わるまでの30〜40分ぶん、実際の受け渡しと所持金の増加がずれて見える」ことが
  // 「怒って帰った客の分も売上に乗っているように見える」という体感の原因になっていた)。
  function deliverToSeat(order) {
    var seat = order.seat, a = order.actor;
    if (!a || a.gone || seat.occupant !== a) return;
    a.deliveredAt = nowLabel();
    window.GameAudio.se("serve"); // v39: 丼が客に届いた瞬間。演出のみ(onServeCb の金銭処理より前だが、順序には影響しない)
    // v26(追補§B-2): spawnWeekも渡す。loop.js側で今週の週番号と比較し、週をまたいで配膳された
    // 客(厨房が調理着手済みでclearSeatedWaiters()の安全弁が効かなかったケース)は金銭の加算だけ
    // スキップする。絵の配膳シーケンス(このあとのstartEating等)はそのまま完走させる。
    if (onServeCb) onServeCb(a.segId, a.priceOwed, a.spawnWeek);
    startEating(a);
  }

  // v15-3: 客ごとの注文を、厨房未着手(orderQueue)・盛り付け済みでホール待ち(readyQueue)の
  // 両方から取り除く。厨房が作業中(w.busy)の分はここでは止められないが、出来上がってもdeliverToSeat
  // が客の不在を検知して静かに捨てるので、作り直しのループにはならない。
  function cancelOrderFor(a) {
    orderQueue = orderQueue.filter(function (o) { return o.actor !== a; });
    var before = readyQueue.length;
    readyQueue = readyQueue.filter(function (o) { return o.actor !== a; });
    if (readyQueue.length !== before) renderReadyPile();
  }

  // v14-5: 兼任(1人)。v13までと同じ、寸胴→茹で麺器→盛り付け→客席→定位置、の一続き。
  // 客席へ届けた瞬間に食べ始めさせる(以前は席に着いてから固定時間で自動的に食べ始めていた)。
  // v28-2(追補2§J):「1人兼任(従業員1人)の場合=調理+ホール1サイクルの合計=目標間隔」。
  // 移動時間を含む全行程の合計がtargetIntervalMin()と一致するよう、pace(店全体で共通の速度係数)を
  // この1件ぶんの実際の距離から逆算する。個人の能力(旧5能力)は参照しない。
  // v32(§37): カウンター席は「客席へ運ぶ」を「受け渡し口=GEO.plateで直接手渡す」に短縮する
  // (実際には客がすぐそこに座っているという設定のため、盛り付け台から先の移動が要らない)。
  function runSoloCycle(w, order) {
    w.busy = true;
    w.el.classList.add("carrying");
    var target = targetIntervalMin();
    var fromX = parseFloat(w.el.dataset.x != null ? w.el.dataset.x : w.homeX);
    var fromY = w.curY != null ? w.curY : GEO.kitchenHome.y;
    var seat = order.seat;
    var isCounter = seat.kind === "counter";
    var stops = isCounter ? [
      { x: GEO.soup.x, y: GEO.soup.y, wait: 0 },
      { x: GEO.noodle.x, y: GEO.noodle.y, wait: 0 },
      { x: GEO.plate.x, y: GEO.plate.y, wait: 0, deliver: true }, // 受け渡し口=カウンター客への直接提供
      { x: w.homeX, y: w.homeY, wait: 0 }
    ] : [
      { x: GEO.soup.x, y: GEO.soup.y, wait: 0 },
      { x: GEO.noodle.x, y: GEO.noodle.y, wait: 0 },
      { x: GEO.plate.x, y: GEO.plate.y, wait: 0 },
      { x: seat.x, y: seat.y, wait: 0, deliver: true },
      { x: w.homeX, y: w.homeY, wait: 0 }
    ];
    var stationCount = isCounter ? 3 : 3; // 寸胴・茹で麺器・盛り付け(共通)
    var baseTravel = 0;
    var fx = fromX, fy = fromY;
    stops.forEach(function (s) { baseTravel += legBaseMs(fx, fy, s.x, s.y); fx = s.x; fy = s.y; });
    var baseWait = gm(KITCHEN_STATION_MIN) * stationCount + gm(KITCHEN_HANDOFF_MIN);
    var pace = (baseTravel + baseWait) / gm(target);
    var pauseMs = gm(KITCHEN_STATION_MIN) / pace;
    var handoffMs = gm(KITCHEN_HANDOFF_MIN) / pace;
    stops.forEach(function (s, i) {
      if (i === stops.length - 1) return; // 最後(定位置へ戻る)は待ちを付けない
      s.wait = s.deliver ? handoffMs : pauseMs;
    });
    function step(i) {
      if (w.gone) return;
      if (i >= stops.length) { w.busy = false; dispatchOrders(); return; }
      var s = stops[i];
      var travelMs = moveWorker(w, s.x, s.y, pace);
      later(function () {
        if (s.deliver) { w.el.classList.remove("carrying"); deliverToSeat(order); }
        step(i + 1);
      }, travelMs + s.wait);
    }
    step(0);
  }

  // v14-5: 厨房担当。寸胴→茹で麺器→盛り付けまでで、客席へは行かない。
  // v32(§37): テーブル客ぶんは今までどおりreadyQueueへ置いてホール待ちにするが、
  // カウンター客ぶんは盛り付けた瞬間にそのままdeliverToSeat()する(ホールを挟まない)。
  // v28-2(追補2§J):「厨房1人の1サイクル=目標間隔×厨房人数」。dispatchOrders()で人数比例に
  // 並列化される前提のため、1人あたりの持ち時間は目標間隔にその時点の厨房役割の人数を掛けた値。
  function runKitchenCycle(w, order) {
    w.busy = true;
    w.el.classList.add("carrying");
    var kCount = kitchenWorkers.filter(function (x) { return x.role === "kitchen"; }).length || 1;
    var target = targetIntervalMin() * kCount;
    var fromX = parseFloat(w.el.dataset.x != null ? w.el.dataset.x : w.homeX);
    var fromY = w.curY != null ? w.curY : GEO.kitchenHome.y;
    var baseTravel = legBaseMs(fromX, fromY, GEO.soup.x, GEO.soup.y) +
      legBaseMs(GEO.soup.x, GEO.soup.y, GEO.noodle.x, GEO.noodle.y) +
      legBaseMs(GEO.noodle.x, GEO.noodle.y, GEO.plate.x, GEO.plate.y);
    var baseWait = gm(KITCHEN_STATION_MIN) * 3;
    var pace = (baseTravel + baseWait) / gm(target);
    var pauseMs = gm(KITCHEN_STATION_MIN) / pace;
    var stops = [
      { x: GEO.soup.x, y: GEO.soup.y, wait: pauseMs },
      { x: GEO.noodle.x, y: GEO.noodle.y, wait: pauseMs },
      { x: GEO.plate.x, y: GEO.plate.y, wait: pauseMs }
    ];
    function step(i) {
      if (w.gone) return;
      if (i >= stops.length) {
        w.el.classList.remove("carrying");
        w.busy = false;
        if (order.seat.kind === "counter") {
          deliverToSeat(order); // v32(§37): 受け渡し口のすぐそばのカウンター客へ直接提供
        } else {
          readyQueue.push(order);
          renderReadyPile();
        }
        dispatchOrders(); // 次の注文と、待っているホール担当の両方へ回す
        return;
      }
      var travelMs = moveWorker(w, stops[i].x, stops[i].y, pace);
      later(function () { step(i + 1); }, travelMs + stops[i].wait);
    }
    step(0);
  }

  // v14-5: ホール担当。受け渡し口の丼を取る→客席へ運ぶ→受け渡し口寄りの定位置へ戻る。調理設備には触れない。
  // v32(§37): readyQueueにはもうテーブル客ぶんしか積まれない(カウンター客は厨房が直接届けるため)。
  // v28-2(追補2§B・§J):「ホール1サイクル=目標間隔」。常に1人(assignRoles()、変更なし)の
  // ため、この1サイクル(移動時間込み)がそのまま系全体のボトルネックになる。
  function runHallCycle(w, order) {
    w.busy = true;
    var target = targetIntervalMin();
    var fromX = parseFloat(w.el.dataset.x != null ? w.el.dataset.x : w.homeX);
    var fromY = w.curY != null ? w.curY : GEO.kitchenHome.y;
    var seat = order.seat;
    var baseTravel = legBaseMs(fromX, fromY, GEO.plate.x, GEO.plate.y) +
      legBaseMs(GEO.plate.x, GEO.plate.y, seat.x, seat.y) +
      legBaseMs(seat.x, seat.y, w.homeX, w.homeY);
    var baseWait = gm(KITCHEN_HANDOFF_MIN);
    var pace = (baseTravel + baseWait) / gm(target);
    var handoffMs = gm(KITCHEN_HANDOFF_MIN) / pace;
    var stops = [
      { x: GEO.plate.x, y: GEO.plate.y, wait: 0, pickup: true },
      { x: seat.x, y: seat.y, wait: handoffMs, deliver: true },
      { x: w.homeX, y: w.homeY, wait: 0 }
    ];
    function step(i) {
      if (w.gone) return;
      if (i >= stops.length) { w.busy = false; dispatchOrders(); return; }
      var s = stops[i];
      var travelMs = moveWorker(w, s.x, s.y, pace);
      later(function () {
        if (s.pickup) w.el.classList.add("carrying");
        if (s.deliver) { w.el.classList.remove("carrying"); deliverToSeat(order); }
        step(i + 1);
      }, travelMs + s.wait);
    }
    step(0);
  }

  // ---------- 客 ----------
  function segDef(id) { return U.findById(SEGMENTS, id); }

  // v16-2/3: 我慢の限界(ゲーム内分→1x基準ms)。行列(joinQueue)・着席後の待機(enterAndSit)の
  // どちらもこの1つだけを使う。客層ごとの行列耐性(queue_tolerance)だけで個体差を付け、
  // 新しいデータ項目は増やさない。
  function patienceMs(segId) {
    var def = segDef(segId);
    var tol = def ? def.weights.queue_tolerance : 0.5;
    return gm(PATIENCE_BASE_MIN + tol * PATIENCE_TOL_MIN);
  }

  // v32: 満足/普通/不満の3種(img/stage/face_*.webp)は、満足度の数値から選ぶだけ
  // (§0の逆流禁止どおり、絵から数値を作る経路は無い)。3段階の判定式自体は据え置き
  // (moodClassFor()と共有。閾値60/45は既存のまま変更していない)。
  var FACE_EMOJI = { good: "😄", neutral: "😐", bad: "😒" };
  function moodKeyFor(segId) {
    var sat = traffic.satBySeg[segId];
    if (sat == null) return "neutral";
    if (sat >= 60) return "good";
    if (sat >= 45) return "neutral";
    return "bad";
  }
  // v14-2: 絵文字が単色フォント(Noto Emoji)になり表情の区別が付きにくいため、faceFor()と
  // 同じ閾値で満足/普通/不満のクラス名を作り、CSS側(.sv-bubble.mood-*)で色を分ける。
  // v32: 表情そのものは画像(FACE_EMOJIはフォールバック用)になったが、🕐(丼待ち)・😡(退店)の
  // 吹き出しは引き続きこの色分けを使うので、クラスとしては残す。
  function moodClassFor(segId) { return "mood-" + moodKeyFor(segId); }

  function setBubbleText(a, text) {
    window.UI.clear(a.bubble);
    a.bubble.textContent = text;
  }
  function setBubbleFace(a, moodKey) {
    window.UI.clear(a.bubble);
    a.bubble.appendChild(AI.node(stageDef("face_" + moodKey, FACE_EMOJI[moodKey])));
  }

  // ---------- v13-2: 退店時のフィードバック(表情の下に「評判 +1」を出す) ----------
  // 週の評判は既存の式(runWeeklyCalc: reputation += (avgSat-50)*0.04)で週の平均満足度から
  // 一括更新されており、客1人ぶんの寄与という数値は元々存在しない。ここでは新しい数値を作らず、
  // 既存の満足度3段階の判定(moodKeyForと同じ閾値: 60以上=満足/45未満=不満)をそのまま符号に使う
  // ——満足なら平均を押し上げる側(+1)、不満なら押し下げる側(-1)、普通(0)は出さない。
  // 週の実際の評判の増減量そのものはこれまで通りrunWeeklyCalcで一括計算する(ここは表示専用)。
  var activePopups = 0;
  var POPUP_MAX = 3;   // 同時に出るのは最大3件まで
  var POPUP_MS = 800;  // 指示どおり実秒固定(ゲーム内時間ではない)。toast()と同じくlater()を使わない
  function reputationSign(segId) {
    var sat = traffic.satBySeg[segId];
    if (sat == null) return 0;
    if (sat >= 60) return 1;
    if (sat < 45) return -1;
    return 0;
  }
  function showExitPopup(a) {
    var d = reputationSign(a.segId);
    if (!d) return; // 変化なしのときは出さない
    if (activePopups >= POPUP_MAX) return; // うるさくなるので上限を超えたら出さない
    activePopups++;
    var el = h("span", {
      className: "sv-rep-pop " + (d > 0 ? "good" : "bad"),
      text: "評判 " + (d > 0 ? "+" : "") + d
    });
    a.el.appendChild(el);
    setTimeout(function () {
      if (el.parentNode) el.parentNode.removeChild(el);
      activePopups = Math.max(0, activePopups - 1);
    }, POPUP_MS);
  }

  // ---------- v37-3: 会計時のコイン演出(表示のみ) ----------
  // 会計を済ませた客(finishMeal=食べ終わった客だけ。行列で諦めた客・週切替で片付けた客は
  // 支払いが無いので出さない)が席を立つ瞬間に、コイン1枚+キラキラを客の現在位置に出す。
  // 数値(所持金・売上)や状態遷移には一切影響しない、純粋な表示(§大原則)。
  // 要素は客のelにはぶら下げず actorLayer 直下へ独立して置く——客が先にremoveActorされても
  // 演出は完走してから自分で消えるし、同時に複数の客が退店してもそれぞれ独立する。
  // zはCSSの固定値(.sv-coin-fxのz-index:1200=付属物の1000より手前)。zForRow()には触らない。
  // 時間は評判ポップ(POPUP_MS)と同じく実秒固定(later()を使わない=ゲーム速度・一時停止と連動させない)。
  var COIN_FX_MS = 850; // CSSアニメーション0.8sの完走後に確実にDOMから削除する
  function spawnCoinFx(a) {
    if (!actorLayer || !a || !a.el) return;
    var fx = h("div", { className: "sv-coin-fx" }, [
      h("span", { className: "sv-coin" }),
      h("span", { className: "sv-coin-spark s1" }),
      h("span", { className: "sv-coin-spark s2" }),
      h("span", { className: "sv-coin-spark s3" }),
      h("span", { className: "sv-coin-spark s4" })
    ]);
    fx.style.left = a.el.style.left; // 客の現在位置(足元の点)をそのまま使う。移動はしない
    fx.style.top = a.el.style.top;
    actorLayer.appendChild(fx);
    setTimeout(function () { if (fx.parentNode) fx.parentNode.removeChild(fx); }, COIN_FX_MS);
  }

  function makeActor(segId) {
    var def = segDef(segId);
    var useWalk = segId === WALK_SEG_ID && def && def.img;
    var el = h("div", { className: "sv-cust" }, [
      h("span", { className: "sv-bowl" }, [AI.node(stageDef("bowl", "🍜"))]),
      h("span", { className: "sv-body" }, [AI.node(useWalk ? walkImgDef(def, 0) : def || stageDef(null, "🧑"))]),
      h("span", { className: "sv-bubble", text: "" })
    ]);
    placeAt(el, GEO.off.x, GEO.off.y);
    setActorZ(el, GEO.off.x, GEO.off.y);
    var a = {
      id: ++custSeq, // v15-1: 客ごとのID。注文・丼はこの客への参照(actor自体)で1対1に結び付ける
      segId: segId, el: el, seat: null, queued: false, gone: false,
      eatingStarted: false, // v14-5: 丼が届いて食べ始めたかどうか(届くまでは席で待つ)
      waiting: false, // v15-2: 着席して丼を待っている(=我慢の限界タイマーが有効な)間だけtrue
      tgtY: GEO.off.y, // v32: 現在地(y)を追う。move()のたびに更新される(2D移動の距離計算に使う)
      // v15-1/6: ライフサイクルの各時刻(ログ・確認用。計算には一切使わない)
      seatedAt: null, orderedAt: null, deliveredAt: null, eatStartAt: null, exitAt: null, exitReason: null,
      // v13-3: 湧いた瞬間の「今週の1杯あたり売価」を固定で持たせる。週をまたいで退店した場合でも
      // (v12で分かった、帯の終盤に来た客がまれに週をまたいで完食するケース)、この客が本来属していた
      // 週の額のまま計上されるようにするため、退店時ではなく湧いた時点の値を握らせておく。
      priceOwed: traffic.pricePerCustomer || 0,
      // v26(追補§B-2): 同じ理由で、湧いた時点の週番号も固定で持たせる(priceOwedと同じ経路)。
      spawnWeek: traffic.week || 0,
      body: el.querySelector(".sv-body"),
      walk: null, // v37-1: 歩行2コマの状態(適用する客層だけ非null)
      bowl: el.querySelector(".sv-bowl"),
      bubble: el.querySelector(".sv-bubble")
    };
    if (useWalk) {
      a.body.style.fontSize = walkFontEm() + "em";
      a.walk = { frame: 0, key: "f0", back: false, def: def, acc: 0, last: null };
    }
    actorLayer.appendChild(el);
    actors.push(a);
    return a;
  }

  function removeActor(a) {
    if (a.gone) return;
    a.gone = true;
    if (a.el.parentNode) a.el.parentNode.removeChild(a.el);
    var i = actors.indexOf(a);
    if (i >= 0) actors.splice(i, 1);
    var q = queue.indexOf(a);
    if (q >= 0) queue.splice(q, 1);
  }

  // v32: y座標も動かすため、z-indexをここで一括更新する(奥にあるものほど先に描く=手前にいる
  // ものが後で描かれて重なった相手を隠す、をzForRow()で機械的に満たす)。
  // v36-4(docs/完了/v36-4_右隣の建物を抜けて見える客_修正指示書.md、§49): 移動中の z は**足元の現在位置**から
  // 決める。以前は歩き出しの瞬間に到着点の z を書いて歩行中は固定していたため、歩道を右から左へ歩いて入店する客が
  // 到着点(5.5,10.5)の z=260 のまま右隣の建物(z 310〜340)の手前を通り、建物の裏に隠れて「建物の中から出てくる」
  // ように見えた(v36-4調査報告)。位置(left/top)の CSS transition には触れず、rAF で z だけを追従させる。
  function move(a, x, y, ms) {
    if (a.gone) return;
    var dur = Math.max(16, ms / spd());
    a.el.style.transitionDuration = dur + "ms";
    var ty = y != null ? y : (a.tgtY != null ? a.tgtY : 0); // v36-1: 左右の位置もyに依るので、yを動かさない移動でも現在のyで変換する
    a.el.style.left = toPxX(x, ty) + "px";
    if (y != null) { a.el.style.top = toPxY(x, y) + "px"; a.tgtY = y; }
    a.el.classList.toggle("flip", x > (parseFloat(a.el.dataset.x || GEO.off.x)));
    a.el.dataset.x = x; // 単位はマス(px変換前の値。距離計算・向きの判定はマスのまま行う)
    trackZ(a, dur);
  }

  // v36-4: 移動中の俳優の z を毎フレーム足元の実位置(getComputedStyle の left/top = transition 途中の値。
  // pinActor と同じ読み方)から更新する。transition が終わる時刻(zUntil)を過ぎたら到着点の z を書いて追跡から外す。
  // 追跡する俳優が無いときは rAF を回さない(行列が伸びたときの負荷は「動いている人数×getComputedStyle 1回」だけ)。
  var zTracked = [];
  var zRaf = null;
  function applyZFromLayout(a) {
    var cs = getComputedStyle(a.el);
    var cur = fromPx(parseFloat(cs.left), parseFloat(cs.top));
    setActorZ(a.el, cur.x, cur.y);
    stepWalk(a, cur);
  }
  // v37-1: 歩行コマ。zの追跡と同じ実位置(cur、マス)から進んだ距離を積み、WALK_FRAME_CELLSごとにA/Bを入れ替える。
  // 追跡から外れる(到着・一時停止)ときはAに戻す(stopWalk)。
  function stepWalk(a, cur) {
    if (!a.walk) return;
    var w = a.walk;
    if (w.last) {
      var dx = cur.x - w.last.x, dy = cur.y - w.last.y;
      // v37-2: 画面の上下は toPxY=(x+y)×TH/2 なので、Δ(x+y)<0 が「奥向き(画面上方向)」。閾値未満は向きを保つ
      var dv = dx + dy;
      if (Math.abs(dv) >= WALK_BACK_EPS && (dv < 0) !== w.back) { w.back = dv < 0; setWalkFrame(a, w.frame); }
      w.acc += Math.sqrt(dx * dx + dy * dy);
      if (w.acc >= WALK_FRAME_CELLS) { w.acc -= WALK_FRAME_CELLS; setWalkFrame(a, w.frame ? 0 : 1); }
    }
    w.last = cur;
  }
  function stopWalk(a) {
    if (!a.walk) return;
    a.walk.last = null; a.walk.acc = 0;
    a.walk.back = false; // 停止・着席は従来どおり正面walk_a固定
    setWalkFrame(a, 0);
  }
  function trackZ(a, dur) {
    applyZFromLayout(a); // 歩き出しの瞬間は出発点の z(到着点の z ではない)
    a.zUntil = performance.now() + dur + 32; // 終端は transition の完了後に到着点の z へ揃える(+2フレームの余裕)
    if (zTracked.indexOf(a) < 0) zTracked.push(a);
    if (zRaf == null) zRaf = requestAnimationFrame(stepZ);
  }
  function stepZ() {
    zRaf = null;
    var now = performance.now();
    for (var i = zTracked.length - 1; i >= 0; i--) {
      var a = zTracked[i];
      if (a.gone || !a.el.parentNode) { zTracked.splice(i, 1); continue; }
      if (now >= a.zUntil || frozen) {
        // 到着(または一時停止でピン留め)。到着点(dataset.x, tgtY)の z で確定する。一時停止中はピン留めされた
        // 位置の z のまま止め、再開時の move() が再び追跡を始める
        if (frozen) applyZFromLayout(a); else setActorZ(a.el, parseFloat(a.el.dataset.x), a.tgtY != null ? a.tgtY : 0);
        stopWalk(a);
        zTracked.splice(i, 1);
        continue;
      }
      applyZFromLayout(a);
    }
    if (zTracked.length && !frozen) zRaf = requestAnimationFrame(stepZ);
  }
  function stopZTracking() {
    if (zRaf != null) cancelAnimationFrame(zRaf);
    zRaf = null;
    zTracked = [];
  }

  // v32: 斜め上視点では移動が斜めになるため、x・y両方の距離を合成した直線距離で歩行時間を計算する。
  // v35: 距離の単位はマス(旧walkMs<横1軸だけ・参照0件>は削除した)。
  function walkMs2(fromX, fromY, toX, toY, minPerCell) {
    var dx = toX - fromX, dy = toY - fromY;
    return Math.sqrt(dx * dx + dy * dy) * gm(minPerCell || WALK_MIN_PER_CELL);
  }

  // v36-3: 経由点を順に歩く(各区間は move() + later())。合計の所要msを返す。状態遷移の判断(いつ帰るか・
  // いつ座るか)は呼び出し側のまま——変わるのは道筋だけ。一時停止はmove()単位で効く(pinActor/resumeActor)。
  function walkVia(a, pts, minPerCell, done) {
    var fromX = parseFloat(a.el.dataset.x != null ? a.el.dataset.x : GEO.off.x);
    var fromY = a.tgtY != null ? a.tgtY : GEO.off.y;
    var legs = [], total = 0;
    pts.forEach(function (p) { var ms = walkMs2(fromX, fromY, p.x, p.y, minPerCell); legs.push({ p: p, ms: ms }); total += ms; fromX = p.x; fromY = p.y; });
    function step(i) {
      if (a.gone) return;
      if (i >= legs.length) { if (done) done(); return; }
      move(a, legs[i].p.x, legs[i].p.y, legs[i].ms);
      later(function () { step(i + 1); }, legs[i].ms);
    }
    step(0);
    return total;
  }
  // 入口→席の道筋(壁・什器を通り抜けない)。カウンター席: 入口の列を奥へ→カウンター前の通路を横へ→席。
  // 卓の席: 入口の列を奥へ→卓の手前の通路を横へ→席。帰りはこの逆順+歩道へ出て通りの先(off)へ。
  function routeDoorToSeat(seat) {
    if (seat.kind === "counter") return [{ x: GEO.lane.x, y: GEO.frontRow }, { x: GEO.lane.x, y: GEO.aisleRow }, { x: seat.x, y: GEO.aisleRow }, { x: seat.x, y: seat.y }];
    return [{ x: GEO.lane.x, y: GEO.frontRow }, { x: seat.x, y: GEO.frontRow }, { x: seat.x, y: seat.y }];
  }
  // v48-1: **敷地の外(歩道)から入口までの1区間**。店の中の道筋(routeDoorToSeat)は1行も触っていない
  // ——足したのはここだけ。歩道 → 門 → 前庭の道 → 入口の前 → 入口、の順に折れる。
  // **フェンスのマスは1つも通らない**: 門(gate)は表の O = フェンスの切れ目で、
  // 門へ上がる列(gateLane.x)と門の x は同じなので、歩道から前庭までまっすぐ1本の列を上がる。
  // 経由点は全部 GEO 由来(§66-1)。
  // **敷地の外へ出る道筋はこの1本だけ。** 前庭の道 → 門 → 歩道 → off。
  // 退店(routeDoorToOff)と、行列から待ちきれず帰る経路(leaveQueue)の**両方がこれを使う**
  // ——道筋を2か所に書くと、片方だけ直してもう片方がフェンスを突っ切る形が残る。
  function routeYardToOff() {
    return [
      { x: GEO.gateLane.x, y: GEO.yardRow }, // 前庭の道を門の列まで戻る
      { x: GEO.gate.x, y: GEO.gate.y },      // 門を抜ける
      { x: GEO.gate.x, y: GEO.walkRow },     // 歩道へ下りる
      { x: GEO.off.x, y: GEO.off.y }         // 歩道の端で消える(通りは渡らない)
    ];
  }
  // 入口(の前)から敷地の外へ。
  function routeDoorToOff() {
    return [{ x: GEO.door.x, y: GEO.yardRow }].concat(routeYardToOff());
  }
  // **入店は退店の逆順**(off から歩き出して入口で終わる)。1本の道筋から機械的に作るので、
  // 片方だけ経由点が増えて食い違うことがない。
  function routeOffToDoor() {
    return routeDoorToOff().slice(0, -1).reverse().concat([{ x: GEO.door.x, y: GEO.door.y }]);
  }
  function routeSeatToOff(seat) {
    var back = routeDoorToSeat(seat).slice(0, -1).reverse(); // 席の1つ手前から入口側へ戻る
    return back.concat([{ x: GEO.door.x, y: GEO.door.y }]).concat(routeDoorToOff());
  }

  function spawnCustomer(segId) {
    var a = makeActor(segId);
    // 初期位置を確定させてから移動させる。requestAnimationFrame だと
    // タブが非表示のときにコールバックが来ず、客が湧いた位置で固まる。
    void a.el.offsetWidth;
    // v48-1: 歩道を歩いて門をくぐり、前庭の道を通って入口へ(フェンスも建物も通り抜けない)
    walkVia(a, routeOffToDoor(), null, function () { arriveDoor(a); });
  }

  function freeSeat() {
    var open = seats.filter(function (s) { return !s.occupant; });
    if (!open.length) return null;
    return open[U.randInt(0, open.length - 1)];
  }

  // v10-3: 実数だけ湧かせるようになったので、「席が空いていても行列を作る」演出上の水増しは廃止。
  // 満席なら並ぶ・空いていれば座る、という素直な判定にした。行列は実際の混雑から自然に生まれる。
  // v25(§4-2/追補§D-1): 行列の上限とturnAwayFull()を廃止した。並びたい客は全員並べる
  // (queueSlot()が列を折り返して座標を割り当てるので、人数がいくつでも破綻しない)。
  function arriveDoor(a) {
    if (a.gone) return;
    var seat = freeSeat();
    if (seat) { enterAndSit(a, seat); return; }
    joinQueue(a);
  }

  // v25(§4-2): 行列に並んだ順(0始まり)から、列(row)・その中の位置(col)を求めて座標にする。
  // GEO.queueCols人ぶん埋まったら次の列へ折り返す。
  // v32(§1-5/指示書「行列」): 横一列の代わりに、入口のすぐ内側から手前へ短く伸びる斜めの列にした
  // (queueColStepで1人ずつ手前へ、queueRowStepで列が折り返るたびに奥へ少しずらす)。
  function queueSlot(i) {
    var row = Math.floor(i / GEO.queueCols);
    var col = i % GEO.queueCols;
    return {
      x: GEO.queueOrigin.x + col * GEO.queueColStep.dx + row * GEO.queueRowStep.dx,
      y: GEO.queueOrigin.y + col * GEO.queueColStep.dy + row * GEO.queueRowStep.dy
    };
  }

  function layoutQueue() {
    queue.forEach(function (a, i) {
      var slot = queueSlot(i);
      move(a, slot.x, slot.y, gm(QUEUE_REFLOW_MIN));
    });
  }

  // v16-3: 行列に並ぶ判断も、着席後に丼を待つ判断も、同じ我慢の限界(patienceMs)を使う
  // (指示書「別々の仕組みを作らない」への対応。v15までは行列側だけ確率判定だった)。
  function joinQueue(a) {
    a.queued = true;
    queue.push(a);
    layoutQueue();
    later(function () {
      if (a.gone || !a.queued) return;
      leaveQueue(a);
    }, patienceMs(a.segId));
  }

  function leaveQueue(a) {
    a.queued = false;
    var i = queue.indexOf(a);
    if (i >= 0) queue.splice(i, 1);
    layoutQueue();
    a.exitAt = nowLabel();
    a.exitReason = "待ちきれず(行列)";
    logLifecycle(a);
    setBubbleText(a, "😡"); // v15-4: 待ちきれず帰るのは怒った表情に統一(隠さずはっきり見せる)。v25§5で😠→😡(より赤く、視認性を上げる)
    a.bubble.className = "sv-bubble mood-bad";
    a.el.classList.add("show-bubble");
    // v48-1(§2-3): **ここだけ walkVia を使わず off へ直線移動していた。** 店の前がそのまま歩道だった
    // v36-3 までは、行列の位置から off まで一直線でも道の上を通れたので問題にならなかったが、
    // 敷地にフェンスができた以上、直線で帰らせると**フェンスを突っ切る**(§3-4 の「フェンスのマスに
    // 入った点が 0」に必ず引っかかる)。退店と同じ道筋——前庭の道を門まで戻り、門を抜けて歩道へ——に揃えた。
    walkVia(a, routeYardToOff(), null, function () { removeActor(a); });
  }

  function pullFromQueue() {
    if (!queue.length) return;
    var seat = freeSeat();
    if (!seat) return;
    var a = queue.shift();
    a.queued = false;
    layoutQueue();
    enterAndSit(a, seat);
  }

  function enterAndSit(a, seat) {
    seat.occupant = a;
    a.seat = seat;
    window.GameAudio.se("arrive"); // v39: 来店(店に入った瞬間=席へ向かい始めた瞬間)。演出のみ、計算には触れない
    // v26(指示書§3-1、追補§C-1):「今週の客」はweeklyBandSchedule由来の理論値から都度計算する
    // 方式に変わったため、着席イベントを数えるコールバック(onEnterCb)は廃止した。
    a.orderedAt = nowLabel(); // v15-1: 着席が決まった瞬間=注文発生(既存のplaceOrderと同じ瞬間)
    placeOrder(seat, a); // v13-1: 入店=注文発生。手が空いている厨房担当がいなければ席で待ったままになる
    // v36-3: 入口→通路→席の道筋を歩く(壁・什器を通り抜けない)。着席の処理は到着後+ENTER_EXTRA_MINの一拍
    walkVia(a, routeDoorToSeat(seat), SEAT_WALK_MIN_PER_CELL, function () { later(afterArrive, gm(ENTER_EXTRA_MIN) + gm(SIT_MIN)); }); // 尺は旧「歩行+ENTER_EXTRA+SIT」と同じ内訳
    function afterArrive() {
      if (a.gone) return;
      a.seatedAt = nowLabel();
      setBubbleText(a, "🕐");
      a.bubble.className = "sv-bubble mood-neutral";
      a.el.classList.add("show-bubble");
      // v25(指示書§2): 着席した客は丼が届くまで必ず待つ(待ちきれずに席を立つ経路を廃止)。
      // a.waitingは「まだ丼を受け取っていない着席客」の目印として残す
      // (startEating()でfalseになる。週の境界の片付け=clearSeatedWaiters()がこれを見て使う)。
      // v28-2: 配膳(厨房・ホール)は目標間隔まで速くなった一方、客側の着席の尺(SIT_MIN等)は
      // 指示書§Dどおり変更していないため、極端に配膳が速い条件では「着席が完了する前に
      // 丼が届いてstartEating()が先に走る」逆転が起こり得る(既存の実装にはこの逆転が
      // 起こらない前提=常に着席完了→配膳の順、という暗黙の前提があった)。その場合
      // startEating()が既にeatingStarted=true/waiting=falseにしているので、ここで
      // waiting=trueを無条件に上書きしない(eatingStartedならもう「食事中」であり
      // 「丼待ち」ではないため)。数値・タイミング定数は一切変えていない、状態機械の
      // 整合性だけを直す修正。
      if (!a.eatingStarted) a.waiting = true;
    }
  }

  // v14-5: 丼が実際に届いた瞬間(runSoloCycle/runHallCycle/runKitchenCycleのdeliverステップ)にだけ
  // 食べ始めさせる。
  function startEating(a) {
    if (a.gone || a.eatingStarted) return;
    a.eatingStarted = true;
    a.waiting = false; // v15-2: 我慢の限界タイマーはここで無効化(guardで再チェックしているが念のため)
    a.eatStartAt = nowLabel();
    setBubbleText(a, "");
    a.el.classList.remove("show-bubble");
    a.el.classList.add("eating");
    // v10-3/v12-1: 滞在時間はゲーム内時間で持つ(提供+食事で30〜40分程度)。実秒は
    // BASE_HOUR_MS(js/utils.js)から作るので、速度体系を変えても比率は崩れない。
    later(function () { finishMeal(a); }, gm(U.rand(MEAL_MIN_MIN, MEAL_MIN_MAX)));
  }

  // v25(指示書§2/追補§B-2): 週の切り替わりの安全弁。着席していてまだ丼を受け取っていない客
  // (a.waiting===true)だけを片付ける。食事中の客(a.waiting===false)には触れない。
  // 「我慢の限界」の復活ではない——客ごとのタイマーでは判定せず、週の境界という構造的な
  // 区切りで一律に片付けるだけ(新しい数値・定数は作らない)。見た目は行列で諦めた客と同じ扱い。
  // 客が退店できるのはここ・finishMeal()・leaveQueue()(行列側)だけ。
  // 数値(逃した客数・満足度・評判)には一切影響させない(§Aの数字は週次計算から出る)。
  function clearSeatedWaiters() {
    actors.slice().forEach(function (a) {
      if (a.gone || !a.waiting) return;
      a.waiting = false;
      cancelOrderFor(a); // 厨房・ホールはこの客ぶんを作り続けない(未処理の注文も同時に取り除く)
      a.exitAt = nowLabel();
      a.exitReason = "待ちきれず(週の切り替わり)";
      logLifecycle(a);
      setBubbleText(a, "😡"); // v25§5で😠→😡(より赤く、視認性を上げる)
      a.bubble.className = "sv-bubble mood-bad";
      a.el.classList.add("show-bubble");
      var seat = a.seat;
      if (!seat) return; // 通常は起こらない(a.waiting=trueならa.seatは必ずある。念のための保険)
      later(function () {
        if (a.gone) return;
        seat.occupant = null;
        a.seat = null;
        walkVia(a, routeSeatToOff(seat), SEAT_WALK_MIN_PER_CELL, function () { removeActor(a); }); // v36-3: 入口を通って歩道へ
        pullFromQueue();
      }, gm(LEAVE_WAIT_MIN));
    });
  }

  function finishMeal(a) {
    if (a.gone) return;
    a.exitAt = nowLabel();
    a.exitReason = "食べ終わった";
    logLifecycle(a);
    a.el.classList.remove("eating");
    setBubbleFace(a, moodKeyFor(a.segId));
    a.bubble.className = "sv-bubble " + moodClassFor(a.segId);
    a.el.classList.add("show-bubble");
    showExitPopup(a); // v13-2: 退店の動きが始まった瞬間、表情の下に「評判 ±1」を出す(変化があるときだけ)
    // v16-1: 所持金への加算はdeliverToSeat()へ移した(丼が届いた瞬間)。ここでは行わない。
    var seat = a.seat;
    later(function () {
      if (a.gone) return;
      spawnCoinFx(a); // v37-3: 会計時のコイン演出(席を立つ瞬間、客の現在位置に。表示のみ)
      window.GameAudio.se("coin"); // v39: 会計(コイン演出と同時)。演出のみ
      seat.occupant = null;
      a.seat = null;
      walkVia(a, routeSeatToOff(seat), SEAT_WALK_MIN_PER_CELL, function () { removeActor(a); }); // v36-3: 入口を通って歩道へ
      pullFromQueue();
    }, gm(LEAVE_WAIT_MIN));
  }

  // ---------- v10-3: 送り出し(客の湧き)。帯の開始時にその帯ぶんを一括で予約する ----------
  // 「その日・その帯に来る客数を週客数から逆算し、実際にその人数だけ湧かせる」への対応。
  // week次のschedule(js/scoring.jsのweeklyBandSchedule)から、今日の曜日×この帯の内訳を取り出し、
  // 到着時刻を帯の中盤に寄せて(2つの一様乱数の平均≒三角分布)個別にlater()で予約する。
  // 確率で間引く仕組みは無い(誰か1人でも来なくなると週の合計とズレるため、全員を必ず湧かせる)。
  function openBand(bandKey) {
    if (!stage || !state) return;
    var band = U.bandDef(bandKey);
    if (!band) return;
    var dow = U.dow(state.day);
    var counts = (traffic.schedule && traffic.schedule[dow] && traffic.schedule[dow][bandKey]) || {};
    var durationMs = gm((band.end - band.start) * 60); // ゲーム内分→1x基準ms。実際の速さはlater()側で調整される
    Object.keys(counts).forEach(function (segId) {
      var n = counts[segId];
      for (var i = 0; i < n; i++) {
        var t = (Math.random() + Math.random()) / 2; // 中盤に寄せた到着時刻(0〜1)
        later(function () { spawnCustomer(segId); }, t * durationMs);
      }
    });
  }

  // v15-5/v16-2: 帯が終わる瞬間(閉店)。「パッと全員消す」のをやめ、状態ごとに正しい形で退かせる。
  // - 外に並んでいる客: 諦めて帰る(既存のleaveQueueをそのまま使う。「待ちきれず」と同じ形。
  //   満席が続いていた=詰まっていた状況なので、指示書2番の「満席でない状態」には当たらない)
  // - 着席済み・待機中の客: v15では閉店時に強制的に「待ちきれず」扱いで退店させていたが、
  //   v16の確認プレイで、これが「従業員2人・満席でない状態でも、帯が終わる瞬間に丼が
  //   まだ届いていない客が機械的に切り捨てられる」原因になっていることが分かった
  //   (通常営業でも普通に起きてしまい、指示書2番の「満席でない状態では0人」を満たせなかった)。
  //   実店舗でも「すでに座って注文している客を、営業時間が終わったからと追い出す」ことは
  //   しない(新規の呼び込みだけ止める)のが自然なため、v16では着席済みの客には触れないよう
  //   変更した。厨房・ホールは帯の状態を見ずに動き続けるので(dispatchOrders)、残っていた
  //   注文はそのまま作られ続け、客は通常どおり自分の我慢の限界(patienceMs)か配膳で決着する。
  // - 食事中の客: 引き続き何もしない。既存の仕組み(finishMeal)で食べ終わるまで見せてから退店させる
  function closeBand(bandKey) {
    queue.slice().forEach(function (a) { leaveQueue(a); });
  }

  // v13-1: 店員の往復は(客と同じく)move()/later()で駆動するようになったため、CSSキーフレーム用の
  // animationDuration/Delayはもう不要(廃止)。ここでは一時停止クラスの反映とretime()だけ行う。
  function syncSpeed() {
    if (stage) stage.classList.toggle("paused", paused());
    retime(); // v12-1: 速度が変わっていれば、画面上の客の残り時間もここで追随させる
  }

  // ---------- 外部API ----------
  // callbacks: { onServe(segId, price, spawnWeek) v13-3/v16-1(丼が客の席に届いた瞬間。
  // その客ぶんの売価=priceOwedと、湧いた時点の週番号=spawnWeekを渡す。v26追補§B-2でspawnWeekを追加) }
  function mount(container, gameState, callbacks) {
    destroy(); // v35-3(§5): 前の舞台(開業チュートリアルの背景など)が残っていれば、DOMごと片付けてから作る
    state = gameState;
    refreshGeo(); // v48-4a: 読み込んだ state.props(無ければ既定)を停止点へ
    onServeCb = (callbacks && callbacks.onServe) || null;
    // v35(v35-2指示書 §1-2/§4): ?cam=x,y,s が付いているときだけカメラの固定値を上書きする
    // (?grid=1と同じ「URLに付けたときだけ」の確認専用経路。判定点6<scaleが乗った状態でも
    // 崩れないか>の確認に使う。通常プレイは常にfitCamera()の式で決まる初期表示)。
    camOverride = null;
    gridDebug = false;
    camTouched = false;
    try {
      var qs = window.location.search || "";
      var cm = /(^|[?&])cam=(-?[\d.]+),(-?[\d.]+),([\d.]+)/.exec(qs);
      if (cm) camOverride = { x: parseFloat(cm[2]), y: parseFloat(cm[3]), s: parseFloat(cm[4]) };
      gridDebug = /(^|[?&])grid=1(&|$)/.test(qs); // v35-3(§4)
    } catch (e) { /* URLが読めない環境では既定値のまま */ }
    stage = h("div", { className: "shop-stage" });
    container.appendChild(stage);
    bindGestures(); // v35-3 §6
    builtSig = "";
    curSpd = spd();
    lifecycleLog = []; // v15-6: 新しいプレイの開始/再開のたびにログをリセットする
    custSeq = 0;
    ensureBuilt();
  }

  function ensureBuilt() {
    var counts = seatCounts();
    var sig = state.property + "|" + state.equipment.slice().sort().join(",") + "|" +
      state.staffHired.slice().sort().join(",") + "|" + counts.counter + "/" + counts.table;
    if (sig === builtSig) return;
    builtSig = sig;
    clearTimers(); // v10-3: 組み直すと、その帯の予約済みだった到着もろとも消える(既知の割り切り。
    // 設備購入などで帯の途中にシーンを作り直すと、その帯の客が少なめに見えることがある)
    buildScenery();
  }

  // finance / customers は週次計算の結果。schedule はその内訳を「曜日×帯」へ配分したもの
  // (js/scoring.jsのweeklyBandSchedule)。無い場合(開業直後、まだ1週目の計算前)は空の店にする。
  function update(gameState, finance, customers, schedule) {
    state = gameState;
    if (!stage) return;
    ensureBuilt();

    traffic.schedule = schedule || null;
    traffic.queueLevel = customers ? customers.queueLevel : 0;
    // v13-3: 1杯あたり所持金へ加算する額。既存の週次収支(finance.revenue)を今週の客数で均等割り
    // しているだけで、新しい金額は作っていない(全客層とも同じ価格setで支払う前提は既存の計算と同じ)。
    traffic.pricePerCustomer = (finance && finance.totalCustomers > 0) ? finance.revenue / finance.totalCustomers : 0;
    // v26(追補§B-2): 湧かせる客に持たせる週番号。state.weekRevenue.week(loop.jsのstageWeekCustomers
    // が確定させる、既存の週番号)をそのまま使う。新しい通し番号は作らない。
    traffic.week = (state.weekRevenue && state.weekRevenue.week) || 0;
    // v28-2(指示書§2、追補§A): 絵の配膳1杯あたりの目標ゲーム分 T = WEEK_OPERATING_MIN ÷ min(W, S)。
    // A = min(D', S, W) より A <= min(W, S) が常に成立するため、絵が保証すべき上限はWではなく
    // min(W, S)で足りる(Wだけだと過剰に速くなる。追補§A)。D'(需要側)は絶対に入れない
    // (需要が絵の速さを決めると逆流になる。追補§A)。
    // W=customers.staffCapacity(既存、Scoring.staffProcessingCapacity()の戻り値そのもの)。
    // S=座席数×45(既存のwindow.SEATS_TO_WEEKLY_CAPACITY、Scoring.computeWeeklyCustomers()と
    // 同じ式・同じ定数を再利用するだけで、新しい係数は作らない)。
    var W = customers ? customers.staffCapacity : 0;
    var S = window.Scoring.totalSeats(state) * window.SEATS_TO_WEEKLY_CAPACITY;
    var T = Math.min(W > 0 ? W : Infinity, S > 0 ? S : Infinity);
    traffic.targetInterval = (T > 0 && isFinite(T)) ? WEEK_OPERATING_MIN / T : WEEK_OPERATING_MIN;

    traffic.satBySeg = {};
    if (customers) {
      Object.keys(customers.results).forEach(function (id) {
        traffic.satBySeg[id] = customers.results[id].satisfaction;
      });
    }
    syncSpeed();
  }

  function destroy() {
    clearTimers();
    stopZTracking(); // v36-4
    if (hudObserver) { hudObserver.disconnect(); hudObserver = null; }
    // v35-3(§5): 舞台のDOMも取り除く(#screen-setupの背景に残った古い.shop-stageが、営業画面へ
    // 移った後も非表示のまま残って要素の計測・計数に引っかかっていた。v35-3調査報告 3-b)
    if (stage && stage.parentNode) stage.parentNode.removeChild(stage);
    stage = null;
    cameraEl = null;
    actorLayer = null;
    actors = [];
    queue = [];
    staffActors = [];
    kitchenWorkers = [];
    orderQueue = [];
    readyQueue = [];
    orderSeq = 0;
    orderPileEl = null;
    activePopups = 0;
    builtSig = "";
    prevDrawnCounter = null;
    frozen = false;
    onServeCb = null;
    traffic = { schedule: null, queueLevel: 0, satBySeg: {}, pricePerCustomer: 0, week: 0, targetInterval: WEEK_OPERATING_MIN };
  }

  // v09-1: 中央のpauseReasons(js/screens/loop.js)から呼ばれる、唯一の一時停止スイッチ。
  function setPaused(on) { if (on) freeze(); else unfreeze(); }

  // v24(指示書§3-2「演出中にタップされた場合: 残りの席を即座に全部配置」): まだアニメーション
  // 待ち(delay中)のポップ演出を全部即座に最終状態へ進める。sv-stool-popクラスを外すと
  // (.sv-stoolの素の見た目=不透明・アニメーション無しへ戻るだけなので)即座に確定表示になる。
  // ✨はもう出す意味が無いので取り除く。js/screens/setup.jsの演出中タップから呼ばれる。
  function skipSeatPop() {
    if (!stage) return;
    var pops = stage.querySelectorAll(".sv-stool-pop");
    for (var i = 0; i < pops.length; i++) {
      pops[i].classList.remove("sv-stool-pop");
      pops[i].style.animationDelay = "";
    }
    var sparkles = stage.querySelectorAll(".sv-stool-sparkle");
    for (var i = 0; i < sparkles.length; i++) {
      if (sparkles[i].parentNode) sparkles[i].parentNode.removeChild(sparkles[i]);
    }
  }

  return {
    mount: mount, update: update, syncSpeed: syncSpeed, destroy: destroy, setPaused: setPaused,
    openBand: openBand, closeBand: closeBand, skipSeatPop: skipSeatPop,
    clearSeatedWaiters: clearSeatedWaiters, // v25(追補§B-2): 週の切り替わりの安全弁
    getLifecycleLog: function () { return lifecycleLog; } // v15-6: 確認用(客ごとの着席/注文/丼受取/食事開始/退店ログ)
  };
})();
