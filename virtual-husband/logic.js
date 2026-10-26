/*
 * 가상남편 — 게임 로직 (화면과 분리해 둔 순수 로직)
 * 브라우저에서는 window.VH, Node에서는 require()로 쓸 수 있어요.
 *
 * 말투 규칙 (실제 남편 카톡 말투 기준)
 *  - "너", "임마", 혼자 쓰는 "야"는 쓰지 않는다
 *  - 애칭은 뽀뽀미가 기본, 찌찌·똥꼬·코딱지는 가끔. 서로 붙여 쓰지 않는다
 *  - 뽀뽀미는 보통 문장 앞, 찌찌·똥꼬·코딱지는 "야"를 붙여 부른다
 *  - 하소연에는 애교 명령형(~랏/~닷/~능/~느냥)으로 같이 편들어주고,
 *    대출·계약 같은 실무 얘기에서만 원래의 차분한 말투로 바뀐다
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VH = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ───────── 기본 상수 ───────── */
  var MOODS = ['stressed', 'tired', 'calm', 'happy', 'playful'];
  var MOOD_LABEL = {
    stressed: '스트레스',
    tired: '피곤',
    calm: '평온',
    happy: '기분 좋음',
    playful: '장난기 많음'
  };
  var SLOTS = ['morning', 'day', 'evening', 'night'];
  var SLOT_LABEL = { morning: '아침', day: '낮', evening: '저녁', night: '밤' };
  var UNLOCK_AT = 3; // 오늘 대화가 이만큼 쌓이면 메뉴를 말해준다

  function slotFromHour(h) {
    if (h >= 5 && h < 9) return 'morning';
    if (h >= 9 && h < 18) return 'day';
    if (h >= 18 && h < 23) return 'evening';
    return 'night';
  }

  /* ───────── 시간대 × 기분 → 장면 이미지 ───────── */
  var SCENES = {
    morning: { stressed: 'bed_refuse', tired: 'bed_refuse', calm: 'bed_stretch', happy: 'bed_stretch', playful: 'bed_blanket' },
    day:     { stressed: 'sulk', tired: 'yawn', calm: 'desk', happy: 'excited', playful: 'tease' },
    evening: { stressed: 'sulk', tired: 'sofa', calm: 'idle', happy: 'excited', playful: 'tease' },
    night:   { stressed: 'bed_refuse', tired: 'bed_asleep', calm: 'bed_asleep', happy: 'bed_blanket', playful: 'bed_blanket' }
  };
  function sceneFor(slot, mood) {
    return (SCENES[slot] && SCENES[slot][mood]) || 'idle';
  }

  /* ───────── 유틸 ───────── */
  function pick(arr, rng) { return arr[Math.floor(rng() * arr.length) % arr.length]; }
  function weightedPick(items, weights, rng) {
    var total = 0, i;
    for (i = 0; i < weights.length; i++) total += weights[i];
    var roll = rng() * total;
    for (i = 0; i < items.length; i++) {
      if (roll < weights[i]) return items[i];
      roll -= weights[i];
    }
    return items[items.length - 1];
  }
  function dayKey(d) {
    var m = d.getMonth() + 1, dd = d.getDate();
    return d.getFullYear() + '-' + (m < 10 ? '0' + m : m) + '-' + (dd < 10 ? '0' + dd : dd);
  }
  function dayDiff(a, b) {
    return Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 86400000);
  }

  /* ───────── 애칭 ─────────
   * word: 애칭 / suffix: 부를 때 붙는 말 / lead: 문장 앞에 올 확률 / weight: 뽑힐 비중 */
  var NICKS = [
    { word: '뽀뽀미', suffix: '',  lead: 0.8, weight: 60 },
    { word: '찌찌',   suffix: '야', lead: 0.3, weight: 14 },
    { word: '똥꼬',   suffix: '야', lead: 0.3, weight: 13 },
    { word: '코딱지', suffix: '야', lead: 0.3, weight: 13 }
  ];
  function nickDisplay(n) { return n.word + n.suffix; }

  /* 대사 한 줄에 애칭을 붙인다. opts: { prob, onlyBbo, last } */
  function attachNickname(line, rng, opts) {
    opts = opts || {};
    var prob = opts.prob == null ? 0.6 : opts.prob;
    if (rng() >= prob) return { text: line, nick: null };

    var pool = opts.onlyBbo ? [NICKS[0]] : NICKS.filter(function (n) { return n.word !== opts.last; });
    if (!pool.length) pool = NICKS;
    var nick = weightedPick(pool, pool.map(function (n) { return n.weight; }), rng);
    var disp = nickDisplay(nick);

    if (rng() < nick.lead) {
      return { text: disp + '~ ' + line, nick: nick.word };
    }
    var m = line.match(/^([\s\S]*?)([!?~.…ㅋㅎㅠㅜ]*)$/);
    var base = m[1], tail = m[2];
    if (!base) return { text: disp + '~ ' + line, nick: nick.word };
    return { text: base + ' ' + disp + tail, nick: nick.word };
  }

  /* ───────── 대사 뱅크 ───────── */
  var LINES = {
    greeting: {
      morning: ['일어났느냥?? 오늘도 출근이닷!!', '눈 떴느냥?? 화이팅하고 나가랏!!', '아침이닷!! 밥은 챙겨 먹고 가랏!!'],
      day:     ['점심은 맛있게 먹었느냥??', '오늘 일은 할만하느냥?? 힘내랏!!', '게임하다가 딱 걸렸닷ㅋㅋ'],
      evening: ['왔느냥?? 오늘 하루 어땠느냥??', '퇴근했느냥?? 고생했닷!!', '저녁 뭐 먹을지 생각해봤닷ㅋㅋ'],
      night:   ['아직 안 잤느냥?? 이제 슬슬 자랏!!', '오늘도 고생했닷!! 푹 자랏!!', '졸린데 안 자고 기다렸닷...']
    },
    idle: {
      stressed: ['오늘 좀 힘든 날이다닷... 얘기해보랏!!', '표정이 안 좋다능... 무슨 일 있느냥??'],
      tired:    ['눈이 반쯤 감겼닷... 일찍 쉬랏!!', '피곤하느냥?? 눕자닷!!'],
      calm:     ['오늘은 평화롭다능~', '아무 일 없는 날이 제일 좋다닷!!'],
      happy:    ['오늘 기분 좋다닷!! 나도 신난다능!!', '뭔가 좋은 일 있었느냥?? 말해보랏!!'],
      playful:  ['오늘은 장난치고 싶다닷ㅋㅋ', '찔러볼 테면 찔러보랏ㅋㅋ']
    },
    hungry: ['배고프닷!! 밥 달랏!!', '꼬르륵 소리 들리느냥?? 밥 주랏!!'],
    poke:  ['왜 찌르느냥ㅋㅋ', '아파 살살하랏', '심심하느냥?? 말을 걸랏', '자꾸 찌르면 삐진다닷', '콕콕 찌르지 말랏ㅋㅋ'],
    pet:   ['헤헿 좋다느냥', '더 쓰다듬어달랏', '기분 좋아진다능', '머리 부스스해진다닷ㅋㅋ', '그렇게 쓰다듬으면 잠든다능...'],
    touch: ['거긴 안 된다느냥!!!', '깜짝이야 뭐하는거느냥ㅋㅋ', '음흉하구나...', '잠깐 잠깐 거기는 반칙이닷!!', '이건 신고감이닷ㅋㅋ'],
    feed:  ['냠냠 고맙닷!!', '더 달랏', '맛있다능 사랑한다닷', '꿀꺽 잘 먹겠닷!!', '배가 빵빵해진다닷ㅋㅋ'],
    full:  ['배불러서 더 못 먹는다닷...', '이제 숨도 못 쉬겠다능ㅋㅋ'],
    attackBodyslam: ['으라차차 무게 공격이다닷!! 깔아뭉개주마!!', '엉덩이 폭탄 투하닷!! 으악 비켜랏!!'],
    attackDandruff: ['비듬 털어서 화이트 크리스마스~~~!!', '눈이 온다닷!! 메리 비듬마스닷ㅋㅋ'],
    attackEarwax:   ['귓밥 나왔다닷!! 이건 요정가루라고 우겨본다닷ㅋㅋㅋ', '반짝반짝 요정가루닷!! 귓밥 아니라고 했닷!!'],
    chatStress: [
      '뭔데?? 무슨 일 있었길래?? 다 이야기해봐랏!!',
      '아니 그건 또 왜 그러느냥?? 완전 또라이닷ㅋㅋ',
      '그 사람 진짜 이상하다닷!! 신경 쓰지 말랏!!',
      '고생했다능... 오늘은 아무 생각 말고 맛있는 거나 먹자닷!!',
      '에휴 그런 일이 있었느냥ㅠㅠ 내가 대신 혼내줄까닷??',
      '힘들면 힘들다고 말해도 된다닷!! 다 듣고 있다능!!'
    ],
    chatTired: ['피곤하느냥?? 일찍 자랏!!', '눈이 반쯤 감겼다능... 오늘은 일찍 쉬자닷!!', '커피 말고 잠이 필요하다닷!!'],
    chatHappy: ['오오 기분 좋은 날이닷!! 나도 신난다능!!', '그런 날엔 맛있는 거 먹어야 한다닷!!', '좋은 일 있었느냥?? 자세히 말해보랏!!'],
    chatPlayful: ['심심하느냥?? 나랑 놀자닷!!', 'ㅋㅋㅋ 장난치고 싶구나 좋다닷!!', '뭐하고 있었느냥?? 궁금하다닷!!'],
    chatLove: ['사랑한데이~~', '사랑한닷!!', '사랑한다 사랑한다 사랑한다닷!!!', '안 물어봤는데 말할게닷. 사랑해. 끝.', '나도 사랑한다능!! 빨리 보고싶다닷!!'],
    chatCasual: ['오호 그렇느냥?? 더 얘기해보랏!!', '음음 계속 말해보랏!!', '그래서 그래서?? 궁금하다닷!!', '오늘 컨디션 어떠느냥??', '밥은 챙겨 먹었느냥??', '오늘 있었던 일 하나만 말해보랏!!'],
    // 대출·계약 같은 실무 얘기: 애교 없이 원래의 차분한 말투
    chatPractical: [
      '그렇구나. 하나씩 같이 정리해보자.',
      '복잡하겠다. 어떤 것부터 확인해야 하는지 순서부터 잡아보자.',
      '고생 많았다. 필요한 서류나 일정 있으면 말해줘.',
      '내가 옆에서 같이 챙길게. 급한 것부터 말해줘.',
      '확인할 게 많겠다. 기한이 언제인지부터 같이 보자.'
    ],
    foodUnlocked: ['오늘 메뉴 정해놨닷!! 메뉴 탭 보랏!!', '메뉴는 이미 정했다능!! 메뉴 탭에서 확인하랏!!'],
    foodLocked: ['아직 대화가 모자란다닷ㅋㅋ 조금만 더 얘기하랏!!'],
    unlock: ['오늘 메뉴 정했닷!! 메뉴 탭에서 확인하랏!!'],
    confirm: ['콜이닷!! 맛있게 먹자능!!', '좋았어 그걸로 가자닷!!'],
    reasonMatched: {
      stressed: '오늘은 스트레스 받는 날이니까 매운 걸로 풀어야 한다닷!!',
      tired: '피곤한 날엔 속 편한 게 최고라능!!',
      calm: '평온한 날엔 담백하게 가자닷~',
      happy: '기분 좋은 날엔 신나는 메뉴로 가자닷!!',
      playful: '오늘은 장난기 모드니까 손으로 집어먹는 걸로 가자닷ㅋㅋ'
    },
    reasonOther: '오늘은 그냥 이게 땡긴다능...',
    reasonFriday: '금요일은 삼겹살데이닷!! 다른 건 안 받는다능!!'
  };

  function flatten(o, out) {
    out = out || [];
    if (typeof o === 'string') out.push(o);
    else if (Array.isArray(o)) o.forEach(function (x) { flatten(x, out); });
    else if (o && typeof o === 'object') Object.keys(o).forEach(function (k) { flatten(o[k], out); });
    return out;
  }
  function allLines() { return flatten(LINES); }

  /* ───────── 홈 화면 반응 ───────── */
  var REACTIONS = {
    poke:  { img: 'tease',   lines: LINES.poke },
    pet:   { img: 'excited', lines: LINES.pet },
    touch: { img: 'sulk',    lines: LINES.touch },
    feed:  { img: 'idle',    lines: LINES.feed }
  };
  var ATTACKS = [
    { kind: 'bodyslam', img: 'atk_bodyslam', lines: LINES.attackBodyslam },
    { kind: 'dandruff', img: 'atk_dandruff', lines: LINES.attackDandruff },
    { kind: 'earwax',   img: 'atk_earwax',   lines: LINES.attackEarwax }
  ];
  var ATTACK_CHANCE = 0.2;

  function greeting(slot, rng, last) {
    return attachNickname(pick(LINES.greeting[slot] || LINES.greeting.day, rng), rng, { prob: 0.7, last: last });
  }
  function idleLine(mood, hungry, rng, last) {
    var base = hungry ? pick(LINES.hungry, rng) : pick(LINES.idle[mood] || LINES.idle.calm, rng);
    return attachNickname(base, rng, { prob: 0.5, last: last });
  }
  function reaction(kind, rng, last, extra) {
    var r = REACTIONS[kind];
    var line = (extra && extra.line) || pick(r.lines, rng);
    var n = attachNickname(line, rng, { prob: 0.5, last: last });
    return { img: r.img, text: n.text, nick: n.nick };
  }
  function attack(rng, last) {
    var a = pick(ATTACKS, rng);
    var n = attachNickname(pick(a.lines, rng), rng, { prob: 0.3, last: last });
    return { kind: a.kind, img: a.img, text: n.text, nick: n.nick };
  }
  function rollAttack(rng) { return rng() < ATTACK_CHANCE; }

  /* ───────── 대화 분류 ───────── */
  var KW = {
    practical: ['대출', '계약', '전세', '월세', '이자', '예약', '병원', '검사', '일정', '은행', '서류', '보험', '세금', '청약', '이사', '결제', '환불', '신청', '마감', '만기', '등기', '비자', '항공', '숙소', '예산'],
    stress: ['힘들', '짜증', '스트레스', '열받', '화나', '속상', '서러', '우울', '빡', '싫어', '울고', '울적', '답답', '불안', '걱정'],
    tired: ['피곤', '졸려', '졸림', '졸리', '지쳐', '지쳤', '기운', '나른', '잠와', '눕고', '늘어'],
    happy: ['기분 좋', '기분좋', '좋아!', '신나', '행복', '최고', '기뻐', '설레', '대박', '좋은 일', '합격', '칭찬', '맛있'],
    playful: ['심심', '장난', '놀자', '놀아', 'ㅋㅋ', 'ㅎㅎ', '뭐해', '뭐하'],
    love: ['사랑', '보고싶', '보고 싶', '좋아해'],
    food: ['배고', '뭐 먹', '뭐먹', '저녁', '메뉴', '점심', '밥 먹', '야식']
  };
  function has(text, list) {
    for (var i = 0; i < list.length; i++) if (text.indexOf(list[i]) !== -1) return true;
    return false;
  }
  function classify(text) {
    var t = String(text || '').trim();
    var stress = has(t, KW.stress);
    if (has(t, KW.practical) && !stress) return 'practical';
    if (stress) return 'stress';
    if (has(t, KW.tired)) return 'tired';
    if (has(t, KW.love)) return 'love';
    if (has(t, KW.food)) return 'food';
    if (has(t, KW.happy)) return 'happy';
    if (has(t, KW.playful)) return 'playful';
    return 'casual';
  }
  var TOPIC_MOOD = { stress: 'stressed', tired: 'tired', happy: 'happy', love: 'happy', playful: 'playful' };

  /* ctx: { count, unlocked, last }  →  { text, topic, mood, serious, nick } */
  function reply(text, ctx, rng) {
    ctx = ctx || {};
    var topic = classify(text);
    var serious = topic === 'practical';
    var line;
    switch (topic) {
      case 'practical': line = pick(LINES.chatPractical, rng); break;
      case 'stress':    line = pick(LINES.chatStress, rng); break;
      case 'tired':     line = pick(LINES.chatTired, rng); break;
      case 'happy':     line = pick(LINES.chatHappy, rng); break;
      case 'playful':   line = pick(LINES.chatPlayful, rng); break;
      case 'love':      line = pick(LINES.chatLove, rng); break;
      case 'food':
        line = ctx.unlocked ? pick(LINES.foodUnlocked, rng)
          : pick(LINES.foodLocked, rng) + ' (' + Math.min(ctx.count || 0, UNLOCK_AT) + '/' + UNLOCK_AT + ')';
        break;
      default:          line = pick(LINES.chatCasual, rng);
    }
    var n = attachNickname(line, rng, { prob: serious ? 0.4 : 0.6, onlyBbo: serious, last: ctx.last });
    return { text: n.text, topic: topic, mood: TOPIC_MOOD[topic] || null, serious: serious, nick: n.nick };
  }

  /* ───────── 오늘의 메뉴 ───────── */
  var FOOD_POOL = [
    { name: '매운 김치찜',  tags: ['stressed'],           w: 3 },
    { name: '떡볶이',       tags: ['stressed', 'playful'], w: 2 },
    { name: '죽',           tags: ['tired'],               w: 2 },
    { name: '흰쌀밥 정식',  tags: ['tired', 'calm'],       w: 2 },
    { name: '막국수',       tags: ['calm'],                w: 1 },
    { name: '우동',         tags: ['calm', 'tired'],       w: 1 },
    { name: '파스타',       tags: ['happy'],               w: 2 },
    { name: '피자',         tags: ['happy', 'playful'],    w: 2 },
    { name: '햄버거',       tags: ['happy', 'playful'],    w: 2 },
    { name: '빵',           tags: ['calm'],                w: 1 }
  ];
  var DRINK = '식혜'; // 제일 좋아하는 음료

  /* ctx: { mood, dow(0=일..5=금), exclude:Set } */
  function recommend(ctx, rng) {
    if (ctx.dow === 5) {
      return { food: '삼겹살', drink: DRINK, reason: LINES.reasonFriday, friday: true };
    }
    var exclude = ctx.exclude || new Set();
    var pool = FOOD_POOL.filter(function (f) { return !exclude.has(f.name); });
    if (!pool.length) pool = FOOD_POOL;
    var weights = pool.map(function (f) { return f.tags.indexOf(ctx.mood) !== -1 ? f.w * 3 : f.w; });
    var chosen = weightedPick(pool, weights, rng);
    var matched = chosen.tags.indexOf(ctx.mood) !== -1;
    return {
      food: chosen.name,
      drink: DRINK,
      reason: matched ? LINES.reasonMatched[ctx.mood] : LINES.reasonOther,
      friday: false
    };
  }

  var DATE_IDEAS = {
    stressed: ['노래방 가서 소리 지르기', '동네 한 바퀴 빠르게 걷기'],
    tired:    ['집에서 영화 한 편 보기', '근처에서 짧게 산책하기'],
    calm:     ['동네 산책', '조용한 카페에서 수다'],
    happy:    ['처음 가보는 카페 찾아가기', '맛집 도장깨기'],
    playful:  ['보드게임 카페', '오락실에서 한 판']
  };
  function dateIdea(mood, rng) { return pick(DATE_IDEAS[mood] || DATE_IDEAS.calm, rng); }

  /* 최근 며칠 안에 정한 메뉴 (오늘 제외) */
  function recentFoods(history, today, days) {
    var out = new Set();
    (history || []).forEach(function (h) {
      var d = dayDiff(h.day, today);
      if (d > 0 && d <= days) out.add(h.food);
    });
    return out;
  }

  /* ───────── 상태 ───────── */
  var FULL_DECAY_PER_HOUR = 4;

  function randomMood(rng) {
    return weightedPick(['playful', 'calm', 'tired', 'happy', 'stressed'], [32, 28, 18, 14, 8], rng);
  }
  function defaultState(today, nowMs, rng) {
    return {
      v: 1, day: today, mood: randomMood(rng),
      affection: 30, fullness: 70, fullnessTs: nowMs,
      chatCount: 0, unlockAnnounced: false,
      chat: [], shown: [], pick: null, history: [], lastNick: null
    };
  }
  function rollDay(state, today, rng) {
    if (state.day !== today) {
      state.day = today;
      state.mood = randomMood(rng);
      state.chatCount = 0;
      state.unlockAnnounced = false;
      state.shown = [];
      state.pick = null;
      if (state.history.length > 30) state.history = state.history.slice(-30);
    }
    return state;
  }
  function fullnessNow(state, nowMs) {
    var hours = Math.max(0, (nowMs - state.fullnessTs) / 3600000);
    return Math.max(0, Math.round(state.fullness - hours * FULL_DECAY_PER_HOUR));
  }
  /* 밥주기. 이미 배부르면 거절한다 */
  function feed(state, nowMs) {
    var cur = fullnessNow(state, nowMs);
    if (cur >= 95) return { ok: false };
    state.fullness = Math.min(100, cur + 30);
    state.fullnessTs = nowMs;
    return { ok: true };
  }

  return {
    MOODS: MOODS, MOOD_LABEL: MOOD_LABEL, SLOTS: SLOTS, SLOT_LABEL: SLOT_LABEL, UNLOCK_AT: UNLOCK_AT,
    SCENES: SCENES, FOOD_POOL: FOOD_POOL, LINES: LINES, NICKS: NICKS,
    slotFromHour: slotFromHour, sceneFor: sceneFor, dayKey: dayKey,
    attachNickname: attachNickname, allLines: allLines,
    greeting: greeting, idleLine: idleLine, reaction: reaction, attack: attack, rollAttack: rollAttack,
    classify: classify, reply: reply,
    recommend: recommend, dateIdea: dateIdea, recentFoods: recentFoods,
    defaultState: defaultState, rollDay: rollDay, fullnessNow: fullnessNow, feed: feed
  };
});
