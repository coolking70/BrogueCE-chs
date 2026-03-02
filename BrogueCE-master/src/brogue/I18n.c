#include "Rogue.h"
#include <ctype.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#ifdef __EMSCRIPTEN__
#include <emscripten.h>

// Logs a (already-cleaned) untranslated string to the browser console,
// deduplicated. window.showUntranslated() dumps the full collected list at any
// time.
EM_JS(void, logUntranslatedString, (const char *str), {
  if (!window._brogueMissing) {
    window._brogueMissing = new Set();
    window._brogueMissingList = [];
    window.showUntranslated = function() {
      var list = window._brogueMissingList;
      console.log('=== 未翻译字串汇总 (' + list.length + ' 条) ===');
      list.forEach(function(s) { console.log(s); });
      console.log('=== 结束 ===');
    };
  }
  var s = UTF8ToString(str);
  // Deduplicate case-insensitively so "You remember..." and "you remember..."
  // collapse to one entry.
  var key = s.toLowerCase();
  if (!window._brogueMissing.has(key)) {
    window._brogueMissing.add(key);
    window._brogueMissingList.push(s);
    console.log('[未翻译] ' + s);
  }
});

// Strip Brogue color-escape sequences then log if the result still contains
// English letters.
//
// encodeMessageColor() encodes color as 4 bytes:
//   [COLOR_ESCAPE=25]  [25+r]  [25+g]  [25+b]
// The r/g/b bytes are always 25..125, never 0, so we can safely skip them.
// Any other control char (< 32, except \n/\t/\r) means the string is already
// a fully-assembled display buffer — bail out to avoid spurious log entries.
void logUntranslatedStripped(const char *s) {
  if (!s || !s[0])
    return;
  // Static to avoid burning ~14KB of WASM stack on every call.
  // Brogue/WASM is single-threaded so static is safe here.
  static char stripped[TEXT_MAX_LENGTH * 2];
  int j = 0;
  int maxRun = 0; // longest consecutive English-letter run seen
  int curRun = 0;
  for (int i = 0; s[i] && j < (int)(sizeof(stripped) - 1); i++) {
    unsigned char c = (unsigned char)s[i];
    if (c == COLOR_ESCAPE) {
      i += 3; // skip 4-byte sequence (loop will ++i one more time)
      curRun = 0;
    } else if (c < 32) {
      if (c != '\n' && c != '\t' && c != '\r') {
        j = 0;
        break; // unknown control char — discard entire string
      }
      curRun = 0;
    } else {
      stripped[j++] = (char)c;
      if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')) {
        if (++curRun > maxRun)
          maxRun = curRun;
      } else {
        curRun = 0;
      }
    }
  }
  stripped[j] = '\0';
  if (maxRun >= 3 && j > 2) {
    // Exclude allowed English words (proper nouns, keybinds)
    if (strstr(stripped, "Yendor") != NULL && maxRun <= 6) {
      // "Yendor" has 6 letters. If there's no longer English run, ignore it.
      return;
    }
    if (strstr(stripped, "<hjklyubn>") != NULL ||
        strstr(stripped, "<tab>") != NULL ||
        strstr(stripped, "a-z; shift") != NULL) {
      // Keyboard mapping hints should be ignored.
      return;
    }
    logUntranslatedString(stripped);
  }
}

#define LOG_UNTRANSLATED_STRIP(s)                                              \
  do {                                                                         \
    logUntranslatedStripped(s);                                                \
  } while (0)

#else
// No-op stubs for non-Emscripten builds.
void logUntranslatedStripped(const char *s) { (void)s; }
#define LOG_UNTRANSLATED_STRIP(s) ((void)0)
#endif

extern char dataDirectory[];

static size_t parsePrintfTokenLength(const char *s);

typedef struct TranslationPair {
  const char *en;
  const char *zh;
} TranslationPair;

typedef struct DynamicTranslationPair {
  char *en;
  char *zh;
} DynamicTranslationPair;

static boolean useChinese = true;
static DynamicTranslationPair *jsonTranslations = NULL;
static size_t jsonTranslationCount = 0;
static boolean jsonLoadAttempted = false;
static char renderedTemplateBuffer[TEXT_MAX_LENGTH];

static const TranslationPair kFallbackTranslations[] = {
    {"Health", "生命值"},
    {"Nutrition", "营养"},
    {"Nutrition (Hungry)", "营养（饥饿）"},
    {"Nutrition (Weak)", "营养（虚弱）"},
    {"Nutrition (Faint)", "营养（昏厥）"},

    {"Press space to continue.", "按空格继续。"},
    {"Touch anywhere to continue.", "点击任意位置继续。"},
    {"Press space or click to continue.", "按空格或点击继续。"},

    {"Exploring... press any key to stop.", "正在探索... 按任意键停止。"},
    {"Exploring... touch anywhere to stop.", "正在探索... 点击任意位置停止。"},

    {"Color effects disabled.", "颜色效果已关闭。"},
    {"Color effects enabled.", "颜色效果已开启。"},
    {"Stealth range displayed.", "已显示潜行范围。"},
    {"Stealth range hidden.", "已隐藏潜行范围。"},
    {"you see %s.", "你看到 %s。"},
    {"You see %s.", "你看到 %s。"},
    {"you see a %s.", "你看到一只%s。"},
    {"You see a %s.", "你看到一只%s。"},
    {"you see a jackal.", "你看到一只豺狼。"},
    {"You see a jackal.", "你看到一只豺狼。"},
    {"you see a kobold.", "你看到一只狗头人。"},
    {"You see a kobold.", "你看到一只狗头人。"},
    {"A %s potion", "一瓶%s药水"},
    {"a %s potion", "一瓶%s药水"},
    {"an %s potion", "一瓶%s药水"},
    {"This flask contains a swirling %s liquid. Who knows what it will do when "
     "drunk or thrown?",
     "这个瓶子里盛着旋转的%s液体。谁知道喝下或投掷后会发生什么？"},
    {"%s missed %s", "%s未能击中%s"},
    {"the %s missed %s.", "%s未能击中%s。"},
    {"see", "看到"},
    {"sense", "感知到"},
    {"increase", "提高"},
    {"decrease", "降低"},
    {"destroy", "摧毁"},
    {"kill", "击杀"},
    {", assuming it has no hidden properties,", "，假设它没有隐藏属性，"},
    {"moves quickly", "移动很快"},
    {"regenerates quickly", "恢复很快"},
    {"attacks quickly", "攻击很快"},
    {"attacks slowly", "攻击缓慢"},
    {"does not regenerate", "不会恢复"},
    {"has a rare mutation", "拥有罕见变异"},
    {"a jackal", "一只豺狼"},
    {"the jackal", "这只豺狼"},
    {"Jackal", "豺狼"},
    {"a kobold", "一只狗头人"},
    {"the kobold", "这只狗头人"},
    {"Kobold", "狗头人"},
    {"%s is lying on %s.", "%s正躺在%s上。"},
    {"%s is lying in %s.", "%s正躺在%s中。"},
    {"%s are lying on %s.", "%s正躺在%s上。"},
    {"%s are lying in %s.", "%s正躺在%s中。"},
    {"%s is sleeping on %s.", "%s正在%s上睡觉。"},
    {"%s is sleeping in %s.", "%s正在%s中睡觉。"},
    {"The dungeon exit", "地牢出口"},
    {"A downward staircase", "向下的楼梯"},
    {"A bloodwort stalk", "一株血草"},
    {"food", "食物"},
    {"Food", "食物"},
    {"dagger", "匕首"},
    {"sword", "长剑"},
    {"broadsword", "阔剑"},
    {"whip", "鞭子"},
    {"rapier", "细剑"},
    {"flail", "连枷"},
    {"mace", "钉头锤"},
    {"war hammer", "战锤"},
    {"spear", "长矛"},
    {"war pike", "战枪"},
    {"axe", "斧头"},
    {"war axe", "战斧"},
    {"dart", "飞镖"},
    {"incendiary dart", "燃烧飞镖"},
    {"javelin", "标枪"},
    {"leather armor", "皮甲"},
    {"scale mail", "鳞甲"},
    {"chain mail", "锁子甲"},
    {"banded mail", "带甲"},
    {"splint mail", "条甲"},
    {"plate armor", "板甲"},
    {"teleportation", "传送"},
    {"health", "治疗"},
    {"protection", "防护"},
    {"haste", "加速"},
    {"fire immunity", "火焰免疫"},
    {"invisibility", "隐形"},
    {"telepathy", "心灵感应"},
    {"levitation", "漂浮"},
    {"shattering", "粉碎"},
    {"guardian", "守护"},
    {"recharging", "充能"},
    {"negation", "否定"},
    {"yellow", "黄色"},
    {"brown", "棕色"},
    {"mauve", "淡紫色"},
    {"white", "白色"},
    {"black", "黑色"},
    {"blue", "蓝色"},
    {"green", "绿色"},
    {"red", "红色"},
    {"orange", "橙色"},
    {"purple", "紫色"},
    {"pink", "粉色"},
    {"gray", "灰色"},
    {"violet", "紫罗兰色"},
    {"indigo", "靛蓝色"},
    {"cyan", "青色"},
    {"teal", "鸭绿色"},
    {"gold piece", "金币"},
    {"gold pieces", "金币"},
    {"A pile of %i shining gold coins.", "一堆闪亮的金币，共 %i 枚。"},
    {"The %s bear%s no intrinsic enchantment", "%s没有内在附魔"},
    {"The %s bear%s an intrinsic enchantment of %s+%i%s",
     "%s具有内在附魔：%s+%i%s"},
    {"The %s bear%s an intrinsic penalty of %s%i%s", "%s带有内在惩罚：%s%i%s"},
    {"It will reveal its secrets if you defeat %i%s %s with it. ",
     "当你用它击败 %i%s 个%s后，它将显露其秘密。"},
    {"It will reveal its secrets if worn for %i%s turn%s. ",
     "穿戴 %i%s 回合%s后，它将显露其秘密。"},
    {"You are %shungry enough to fully enjoy a %s.",
     "你%s足够饥饿，可以充分享用%s。"},
    {" (in hand) ", "（手持）"},
    {" (worn) ", "（穿着）"},
    {" and ", " 和 "},
    {"and", "和"},
    {"A ration of food. Was it left by former adventurers? Is it a curious "
     "byproduct of the subterranean ecosystem?",
     "一份食物口粮。是前任冒险者留下的吗？还是地下生态系统的奇异副产物？"},
    {"You have room for %i more item%s.", "你还能再携带 %i 个物品%s。"},
    {"Your pack is full.", "你的背包已满。"},
    {"-- press (a-z) for more info -- ", "-- 按 (a-z) 查看更多信息 -- "},
    {"-- touch an item for more info -- ", "-- 点击物品查看更多信息 -- "},
    {"a scroll entitled %s\"%s\"%s", "一张卷轴，标题为 %s\"%s\"%s"},
    {"A scroll entitled %s\"%s\"%s", "一张卷轴，标题为 %s\"%s\"%s"},
    {"you now have a %s (%c).", "你现在拥有%s（%c）。"},
    {"You now have a %s (%c).", "你现在拥有%s（%c）。"},
    {"you now have an %s (%c).", "你现在拥有%s（%c）。"},
    {"You now have an %s (%c).", "你现在拥有%s（%c）。"},
    {"you dispatched %s in %s sleep", "你击杀了%s（在%s睡眠中）"},
    {"you dispatched %s in %s sleep.", "你击杀了%s（在%s睡眠中）。"},
    {"You dispatched %s in %s sleep", "你击杀了%s（在%s睡眠中）"},
    {"You dispatched %s in %s sleep.", "你击杀了%s（在%s睡眠中）。"},
    {"negation charm", "否定护符"},
    {"&scroll of negation", "&否定卷轴"},
    {"&wand of negation", "&否定魔杖"},
    {"shattering charm", "粉碎护符"},
    {"&scroll of shattering", "&粉碎卷轴"},
    {"&staff of tunneling", "&掘洞法杖"},
    {"%s has a %i%% chance to hit you, typically hits for %i%% of your current "
     "health, and at worst, could defeat you in %i hit%s.\n     ",
     "%s有 %i%% 的几率击中你，通常造成你当前生命值 %i%% "
     "的伤害，最坏情况下可能在 %i 击%s内击败你。\n     "},
    {"You have a %i%% chance to hit %s, typically hit for %i%% of $HISHER "
     "current health, and at best, could defeat $HIMHER in %i hit%s.",
     "你有 %i%% 的几率击中%s，通常造成其当前生命值 %i%% 的伤害，最好情况下可在 "
     "%i 击%s内击败$HIMHER。"},

    {"     %sN%sew Game     ", "     %s新%s游戏     "},
    {" *     %sP%slay       ", " *     %s开%s始       "},
    {" *     %sV%siew       ", " *     %s查%s看       "},
    {"       %sQ%suit       ", "       %s退%s出       "},

    {"  New %sS%seeded Game  ", "  %s种%s子新游戏  "},
    {"     %sL%soad Game     ", "     %s读%s取存档     "},
    {"  Change V%sa%sriant   ", "  切换%s变%s体模式   "},
    {"   Change %sM%sode     ", "   切换%s游%s戏模式     "},

    {"   View %sR%secording  ", "   %s回%s放记录  "},
    {"    %sH%sigh Scores    ", "    %s高%s分榜    "},
    {"    %sG%same Stats     ", "    %s游%s戏统计     "},

    {"  %sR%sapid Brogue     ", "  %s快%s速模式     "},
    {"     %sB%srogue        ", "     %s经%s典模式        "},
    {"   Bu%sl%slet Brogue   ", "   %s弹%s丸模式   "},

    {"      %sW%sizard       ", "      %s巫%s师模式       "},
    {"       %sE%sasy        ", "       %s简%s单模式        "},
    {"      %sN%sormal       ", "      %s普%s通模式       "},

    {"-- HIGH SCORES --", "-- 高分榜 --"},
    {"--MORE--", "--更多--"},
    {"   -- PLAYBACK --   ", "   -- 回放中 --   "},
    {"      [PAUSED]      ", "      [已暂停]      "},
};

static void skipWs(const char **p) {
  while (**p && isspace((unsigned char)**p)) {
    (*p)++;
  }
}

static int hexVal(char c) {
  if (c >= '0' && c <= '9')
    return c - '0';
  if (c >= 'a' && c <= 'f')
    return 10 + (c - 'a');
  if (c >= 'A' && c <= 'F')
    return 10 + (c - 'A');
  return -1;
}

static size_t encodeUtf8(unsigned int cp, char out[4]) {
  if (cp <= 0x7F) {
    out[0] = (char)cp;
    return 1;
  }
  if (cp <= 0x7FF) {
    out[0] = (char)(0xC0 | ((cp >> 6) & 0x1F));
    out[1] = (char)(0x80 | (cp & 0x3F));
    return 2;
  }
  if (cp <= 0xFFFF) {
    out[0] = (char)(0xE0 | ((cp >> 12) & 0x0F));
    out[1] = (char)(0x80 | ((cp >> 6) & 0x3F));
    out[2] = (char)(0x80 | (cp & 0x3F));
    return 3;
  }
  out[0] = '?';
  return 1;
}

static boolean parseJsonString(const char **p, char **out) {
  const char *s;
  char *buf;
  size_t cap;
  size_t n = 0;

  if (**p != '"') {
    return false;
  }
  (*p)++;
  s = *p;
  cap = strlen(s) + 1;
  buf = (char *)malloc(cap);
  if (!buf) {
    return false;
  }

  while (**p && **p != '"') {
    char c = *(*p)++;
    if (c == '\\') {
      char esc = *(*p)++;
      if (!esc) {
        free(buf);
        return false;
      }
      switch (esc) {
      case '"':
      case '\\':
      case '/':
        buf[n++] = esc;
        break;
      case 'b':
        buf[n++] = '\b';
        break;
      case 'f':
        buf[n++] = '\f';
        break;
      case 'n':
        buf[n++] = '\n';
        break;
      case 'r':
        buf[n++] = '\r';
        break;
      case 't':
        buf[n++] = '\t';
        break;
      case 'u': {
        int h0 = hexVal((*p)[0]);
        int h1 = hexVal((*p)[1]);
        int h2 = hexVal((*p)[2]);
        int h3 = hexVal((*p)[3]);
        char utf8[4];
        size_t written;
        if (h0 < 0 || h1 < 0 || h2 < 0 || h3 < 0) {
          free(buf);
          return false;
        }
        written = encodeUtf8(
            (unsigned int)((h0 << 12) | (h1 << 8) | (h2 << 4) | h3), utf8);
        for (size_t i = 0; i < written; i++) {
          buf[n++] = utf8[i];
        }
        *p += 4;
        break;
      }
      default:
        buf[n++] = esc;
        break;
      }
    } else {
      buf[n++] = c;
    }
  }

  if (**p != '"') {
    free(buf);
    return false;
  }
  (*p)++;
  buf[n] = '\0';
  *out = buf;
  return true;
}

static void appendJsonTranslation(char *en, char *zh) {
  DynamicTranslationPair *next = (DynamicTranslationPair *)realloc(
      jsonTranslations,
      sizeof(DynamicTranslationPair) * (jsonTranslationCount + 1));
  if (!next) {
    free(en);
    free(zh);
    return;
  }
  jsonTranslations = next;
  jsonTranslations[jsonTranslationCount].en = en;
  jsonTranslations[jsonTranslationCount].zh = zh;
  jsonTranslationCount++;
}

static void normalizeOverescapedQuotes(char *s) {
  char *r, *w;
  if (!s)
    return;
  r = s;
  w = s;
  while (*r) {
    if (r[0] == '\\' && r[1] == '"') {
      *w++ = '"';
      r += 2;
      continue;
    }
    *w++ = *r++;
  }
  *w = '\0';
}

static void loadJsonTranslations(void) {
  FILE *f;
  FILE *probe;
  char *content;
  long size;
  const char *p;
  char path[BROGUE_FILENAME_MAX];
  char mergedPath[BROGUE_FILENAME_MAX];
  const char *overridePath;

  if (jsonLoadAttempted) {
    return;
  }
  jsonLoadAttempted = true;

  overridePath = getenv("BROGUE_LANG_FILE");
  if (overridePath && overridePath[0]) {
    strncpy(path, overridePath, BROGUE_FILENAME_MAX - 1);
    path[BROGUE_FILENAME_MAX - 1] = '\0';
  } else {
    snprintf(mergedPath, BROGUE_FILENAME_MAX, "%s/assets/zh_CN.merged.json",
             dataDirectory);
    probe = fopen(mergedPath, "rb");
    if (probe) {
      fclose(probe);
      strncpy(path, mergedPath, BROGUE_FILENAME_MAX - 1);
      path[BROGUE_FILENAME_MAX - 1] = '\0';
    } else {
      snprintf(path, BROGUE_FILENAME_MAX, "%s/assets/zh_CN.json",
               dataDirectory);
    }
  }

  f = fopen(path, "rb");
  if (!f) {
    return;
  }

  if (fseek(f, 0, SEEK_END) != 0) {
    fclose(f);
    return;
  }
  size = ftell(f);
  if (size < 0) {
    fclose(f);
    return;
  }
  if (fseek(f, 0, SEEK_SET) != 0) {
    fclose(f);
    return;
  }

  content = (char *)malloc((size_t)size + 1);
  if (!content) {
    fclose(f);
    return;
  }
  if (fread(content, 1, (size_t)size, f) != (size_t)size) {
    free(content);
    fclose(f);
    return;
  }
  content[size] = '\0';
  fclose(f);

  p = content;
  skipWs(&p);
  if (*p != '{') {
    free(content);
    return;
  }
  p++;

  for (;;) {
    char *key;
    char *value;

    skipWs(&p);
    if (*p == '}') {
      break;
    }

    if (!parseJsonString(&p, &key)) {
      break;
    }
    skipWs(&p);
    if (*p != ':') {
      free(key);
      break;
    }
    p++;
    skipWs(&p);
    if (!parseJsonString(&p, &value)) {
      free(key);
      break;
    }
    normalizeOverescapedQuotes(key);
    normalizeOverescapedQuotes(value);
    appendJsonTranslation(key, value);

    skipWs(&p);
    if (*p == ',') {
      p++;
      continue;
    }
    if (*p == '}') {
      break;
    }
    break;
  }

  free(content);
}

static boolean hasPrintfPlaceholder(const char *s) {
  for (size_t i = 0; s[i]; i++) {
    // Skip Brogue color-escape sequences: [COLOR_ESCAPE][r+25][g+25][b+25].
    if ((unsigned char)s[i] == COLOR_ESCAPE) {
      i += 3; // skip the 4-byte sequence (loop increments once more)
      continue;
    }
    if (s[i] == '%') {
      if (s[i + 1] == '%') {
        i++;
        continue;
      }
      if (parsePrintfTokenLength(&s[i]) > 0) {
        return true;
      }
    }
  }
  return false;
}

static char *dupString(const char *s) {
  size_t n = strlen(s);
  char *d = (char *)malloc(n + 1);
  if (!d)
    return NULL;
  memcpy(d, s, n + 1);
  return d;
}

static size_t parsePrintfTokenLength(const char *s) {
  size_t i = 1;
  if (!s[0] || s[0] != '%') {
    return 0;
  }
  if (s[1] == '%') {
    return 2;
  }

  while (s[i] && strchr("0123456789$-+0# .", s[i]))
    i++;
  if (s[i] == '.' || (s[i] >= '0' && s[i] <= '9')) {
    while (s[i] && (s[i] == '.' || (s[i] >= '0' && s[i] <= '9')))
      i++;
  }
  if (s[i] == 'h' || s[i] == 'l' || s[i] == 'j' || s[i] == 'z' || s[i] == 't' ||
      s[i] == 'L') {
    if ((s[i] == 'h' && s[i + 1] == 'h') || (s[i] == 'l' && s[i + 1] == 'l')) {
      i += 2;
    } else {
      i += 1;
    }
  }
  if (!s[i]) {
    return 0;
  }
  if (strchr("diuoxXfFeEgGaAcCsSpn", s[i]) == NULL) {
    return 0;
  }
  return i + 1;
}

static size_t placeholderSignature(const char *s, char *out, size_t outCap) {
  size_t i = 0, n = 0;
  if (outCap == 0) {
    return 0;
  }
  while (s[i]) {
    if (s[i] != '%') {
      i++;
      continue;
    }
    if (s[i + 1] == '%') {
      i += 2;
      continue;
    }
    size_t tokenLen = parsePrintfTokenLength(&s[i]);
    if (!tokenLen) {
      i++;
      continue;
    }
    if (n + 1 < outCap) {
      out[n++] = s[i + tokenLen - 1];
    }
    i += tokenLen;
  }
  out[n] = '\0';
  return n;
}

static boolean formatStringIsValid(const char *s) {
  size_t i = 0;
  while (s[i]) {
    size_t tokenLen;
    if (s[i] != '%') {
      i++;
      continue;
    }
    if (s[i + 1] == '%') {
      i += 2;
      continue;
    }
    tokenLen = parsePrintfTokenLength(&s[i]);
    if (!tokenLen) {
      return false;
    }
    i += tokenLen;
  }
  return true;
}

static boolean placeholdersCompatible(const char *srcFmt,
                                      const char *translatedFmt) {
  char srcSig[128];
  char trSig[128];
  if (!formatStringIsValid(srcFmt) || !formatStringIsValid(translatedFmt)) {
    return false;
  }
  size_t srcN = placeholderSignature(srcFmt, srcSig, sizeof(srcSig));
  size_t trN = placeholderSignature(translatedFmt, trSig, sizeof(trSig));
  return srcN == trN && !strcmp(srcSig, trSig);
}

// Returns true if the string contains no Brogue color-escape control bytes,
// meaning it is safe to pass back through tr() for capture translation.
// Strings with COLOR_ESCAPE (25) or other low control chars are display buffers
// (they already contain color formatting) and must not be re-translated.
static boolean isSafeCapture(const char *s) {
  if (!s || !s[0])
    return false;
  for (; *s; s++) {
    unsigned char c = (unsigned char)*s;
    if (c == COLOR_ESCAPE)
      return false;
    if (c < 32 && c != '\n' && c != '\t' && c != '\r')
      return false;
  }
  return true;
}

// Length-limited string search: finds needle[0..needleLen-1] in haystack.
// Unlike strstr(), this does NOT search past the known literal boundary,
// which prevents accidentally matching a later '%s' token in the template.
static const char *strnstrHelper(const char *haystack, const char *needle,
                                 size_t needleLen) {
  if (needleLen == 0)
    return haystack;
  for (; *haystack; haystack++) {
    if (strncmp(haystack, needle, needleLen) == 0)
      return haystack;
  }
  return NULL;
}

// Skip Brogue color-escape sequences in a string.
// Returns pointer to the next character after skipped escape sequences.
static const char *skipColorEscapes(const char *s) {
  while ((unsigned char)*s == COLOR_ESCAPE) {
    // Skip the 4-byte escape sequence: [COLOR_ESCAPE][r+25][g+25][b+25]
    s += 4;
  }
  return s;
}

// Compare characters while skipping color escapes in source string.
// Returns true if characters match, false otherwise.
// Advances source pointer to next character after match.
static boolean compareCharSkipColorEscapes(const char **srcPtr, char expected) {
  const char *s = skipColorEscapes(*srcPtr);
  if (*s != expected) {
    return false;
  }
  *srcPtr = s + 1;
  return true;
}

// Find needle in haystack while skipping color escapes in haystack.
// Returns pointer to the match in haystack, or NULL if not found.
static const char *strnstrHelperSkipColor(const char *haystack,
                                          const char *needle,
                                          size_t needleLen) {
  if (needleLen == 0)
    return haystack;
  for (; *haystack;) {
    const char *h = skipColorEscapes(haystack);
    if (*h == '\0')
      break;
    if (strncmp(h, needle, needleLen) == 0) {
      return haystack; // Return original pointer to maintain offset
    }
    // Move to next character in haystack (skip color escapes if present)
    if ((unsigned char)*haystack == COLOR_ESCAPE) {
      haystack += 4;
    } else {
      haystack++;
    }
  }
  return NULL;
}

// Get length of source string up to the given position, skipping color escapes.
static size_t sourceLengthSkipColor(const char *start, const char *end) {
  size_t len = 0;
  while (start < end) {
    if ((unsigned char)*start == COLOR_ESCAPE) {
      start += 4;
    } else {
      start++;
      len++;
    }
  }
  return len;
}

static boolean templateMatch(const char *tmpl, const char *src, char **captures,
                             int *captureCount, int maxCaptures) {
  const char *t = tmpl;
  const char *s = src;
  int count = 0;

  while (*t) {
    if (*t != '%') {
      if (!compareCharSkipColorEscapes(&s, *t)) {
        return false;
      }
      t++;
      continue;
    }

    // "%%" => literal percent.
    if (t[1] == '%') {
      if (!compareCharSkipColorEscapes(&s, '%'))
        return false;
      t += 2;
      continue;
    }

    size_t tokenLen = parsePrintfTokenLength(t);
    const char *nextLiteralStart;
    const char *nextLiteralEnd;
    size_t nextLiteralLen;
    const char *matchPos;

    if (!tokenLen) {
      return false;
    }
    t += tokenLen;

    nextLiteralStart = t;
    while (*t && *t != '%') {
      t++;
    }
    nextLiteralEnd = t;
    nextLiteralLen = (size_t)(nextLiteralEnd - nextLiteralStart);

    if (count >= maxCaptures) {
      return false;
    }

    if (nextLiteralLen == 0) {
      // Capture remaining source (skip color escapes)
      const char *srcStart = s;
      while (*s) {
        if ((unsigned char)*s == COLOR_ESCAPE) {
          s += 4;
        } else {
          s++;
        }
      }
      captures[count++] = dupString(srcStart);
      break;
    }

    matchPos = strnstrHelperSkipColor(s, nextLiteralStart, nextLiteralLen);
    if (!matchPos) {
      return false;
    }

    // Calculate capture length skipping color escapes
    size_t capLen = sourceLengthSkipColor(s, matchPos);
    captures[count] = (char *)malloc(capLen + 1);
    char *dest = captures[count];
    while (s < matchPos) {
      if ((unsigned char)*s == COLOR_ESCAPE) {
        s += 4;
      } else {
        *dest++ = *s++;
      }
    }
    *dest = '\0';
    count++;

    // Skip the matched literal in source (skip color escapes)
    s = matchPos;
    for (size_t i = 0; i < nextLiteralLen; i++) {
      if (!compareCharSkipColorEscapes(&s, nextLiteralStart[i])) {
        free(captures[count - 1]);
        return false;
      }
    }
  }

  // Skip any remaining color escapes at end of source
  while ((unsigned char)*s == COLOR_ESCAPE) {
    s += 4;
  }

  if (*s != '\0') {
    return false;
  }
  *captureCount = count;
  return true;
}

static const char *renderTemplate(const char *translatedTemplate,
                                  char **captures, int captureCount) {
  const char *t = translatedTemplate;
  char *out = renderedTemplateBuffer;
  size_t left = sizeof(renderedTemplateBuffer) - 1;
  int capIndex = 0;

  while (*t && left > 0) {
    if (*t != '%') {
      *out++ = *t++;
      left--;
      continue;
    }
    if (t[1] == '%') {
      *out++ = '%';
      t += 2;
      left--;
      continue;
    }

    size_t tokenLen = parsePrintfTokenLength(t);
    if (!tokenLen) {
      *out++ = *t++;
      left--;
      continue;
    }
    t += tokenLen;

    if (capIndex < captureCount && captures[capIndex]) {
      size_t n = strlen(captures[capIndex]);
      if (n > left)
        n = left;
      memcpy(out, captures[capIndex], n);
      out += n;
      left -= n;
    }
    capIndex++;
  }
  *out = '\0';
  return renderedTemplateBuffer;
}

void initializeI18n(void) {
  const char *lang = getenv("BROGUE_LANG");
  if (!lang || !lang[0]) {
    useChinese = true;
    return;
  }
  setI18nLanguage(lang);
}

void setI18nLanguage(const char *langCode) {
  if (!langCode) {
    return;
  }

  if (!strncmp(langCode, "en", 2) || !strncmp(langCode, "EN", 2)) {
    useChinese = false;
    return;
  }

  if (!strncmp(langCode, "zh", 2) || !strncmp(langCode, "ZH", 2)) {
    useChinese = true;
    return;
  }
}

const char *tr(const char *src) {
  size_t i;
  static int trCaptureDepth = 0; // Guard against recursive capture translation

  if (!src || !src[0] || !useChinese) {
    return src;
  }

  loadJsonTranslations();
  for (i = 0; i < jsonTranslationCount; i++) {
    if (!strcmp(src, jsonTranslations[i].en)) {
      if (hasPrintfPlaceholder(src)) {
        if (!hasPrintfPlaceholder(jsonTranslations[i].zh) ||
            !placeholdersCompatible(src, jsonTranslations[i].zh)) {
          continue;
        }
      }
      LOG_UNTRANSLATED_STRIP(jsonTranslations[i].zh);
      return jsonTranslations[i].zh;
    }
  }

  for (i = 0;
       i < sizeof(kFallbackTranslations) / sizeof(kFallbackTranslations[0]);
       i++) {
    if (!strcmp(src, kFallbackTranslations[i].en)) {
      if (hasPrintfPlaceholder(src)) {
        if (!hasPrintfPlaceholder(kFallbackTranslations[i].zh) ||
            !placeholdersCompatible(src, kFallbackTranslations[i].zh)) {
          continue;
        }
      }
      LOG_UNTRANSLATED_STRIP(kFallbackTranslations[i].zh);
      return kFallbackTranslations[i].zh;
    }
  }

  // Template matching for strings that have already been formatted at runtime.
  if (hasPrintfPlaceholder(src)) {
    // If source already contains '%', it is likely a format template itself.
    LOG_UNTRANSLATED_STRIP(src);
    return src;
  }

  // Template matching (JSON translations)
  for (i = 0; i < jsonTranslationCount; i++) {
    if (hasPrintfPlaceholder(jsonTranslations[i].en)) {
      char *captures[32] = {0};
      int capCount = 0;
      boolean matched =
          templateMatch(jsonTranslations[i].en, src, captures, &capCount, 32);

      if (matched) {
        // Translate safe captures (e.g. terrain names) BEFORE calling
        // renderTemplate. Only at top level (depth 0) to prevent infinite
        // recursion.
        if (trCaptureDepth == 0) {
          trCaptureDepth++;
          for (int c = 0; c < capCount; c++) {
            if (isSafeCapture(captures[c])) {
              const char *translated = tr(captures[c]);
              if (translated != captures[c]) {
                free(captures[c]);
                captures[c] = dupString(translated);
              }
            }
          }
          trCaptureDepth--;
        }
        const char *rendered =
            renderTemplate(jsonTranslations[i].zh, captures, capCount);
        // Log any still-untranslated (English) captures
        for (int c = 0; c < capCount; c++) {
          if (captures[c] && captures[c][0])
            LOG_UNTRANSLATED_STRIP(captures[c]);
        }
        LOG_UNTRANSLATED_STRIP(rendered);
        for (int c = 0; c < 32; c++)
          free(captures[c]);
        return rendered;
      }
      for (int c = 0; c < 32; c++)
        free(captures[c]);
    }
  }

  // Template matching (fallback translations)
  for (i = 0;
       i < sizeof(kFallbackTranslations) / sizeof(kFallbackTranslations[0]);
       i++) {
    if (hasPrintfPlaceholder(kFallbackTranslations[i].en)) {
      char *captures[32] = {0};
      int capCount = 0;
      if (templateMatch(kFallbackTranslations[i].en, src, captures, &capCount,
                        32)) {
        // Translate safe captures before rendering (top level only)
        if (trCaptureDepth == 0) {
          trCaptureDepth++;
          for (int c = 0; c < capCount; c++) {
            if (isSafeCapture(captures[c])) {
              const char *translated = tr(captures[c]);
              if (translated != captures[c]) {
                free(captures[c]);
                captures[c] = dupString(translated);
              }
            }
          }
          trCaptureDepth--;
        }
        const char *rendered =
            renderTemplate(kFallbackTranslations[i].zh, captures, capCount);
        // Log any still-untranslated captures
        for (int c = 0; c < capCount; c++) {
          if (captures[c] && captures[c][0])
            LOG_UNTRANSLATED_STRIP(captures[c]);
        }
        LOG_UNTRANSLATED_STRIP(rendered);
        for (int c = 0; c < 32; c++)
          free(captures[c]);
        return rendered;
      }
      for (int c = 0; c < 32; c++)
        free(captures[c]);
    }
  }

  LOG_UNTRANSLATED_STRIP(src);
  return src;
}
