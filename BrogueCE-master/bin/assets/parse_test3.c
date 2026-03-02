#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <ctype.h>

#define BROGUE_FILENAME_MAX 1024
#define COLOR_ESCAPE 25
typedef enum { false, true } boolean;

typedef struct DynamicTranslationPair {
    char *en;
    char *zh;
} DynamicTranslationPair;
static DynamicTranslationPair *jsonTranslations = NULL;
static size_t jsonTranslationCount = 0;

static void skipWs(const char **p) { while (**p && isspace((unsigned char) **p)) { (*p)++; } }
static int hexVal(char c) { if (c >= '0' && c <= '9') return c - '0'; if (c >= 'a' && c <= 'f') return 10 + (c - 'a'); if (c >= 'A' && c <= 'F') return 10 + (c - 'A'); return -1; }
static size_t encodeUtf8(unsigned int cp, char out[4]) {
    if (cp <= 0x7F) { out[0] = (char) cp; return 1; }
    if (cp <= 0x7FF) { out[0] = (char) (0xC0 | ((cp >> 6) & 0x1F)); out[1] = (char) (0x80 | (cp & 0x3F)); return 2; }
    if (cp <= 0xFFFF) { out[0] = (char) (0xE0 | ((cp >> 12) & 0x0F)); out[1] = (char) (0x80 | ((cp >> 6) & 0x3F)); out[2] = (char) (0x80 | (cp & 0x3F)); return 3; }
    out[0] = '?'; return 1;
}

static boolean parseJsonString(const char **p, char **out) {
    if (**p != '"') return false;
    (*p)++; const char *s = *p; size_t cap = strlen(s) + 1; char *buf = (char *) malloc(cap); size_t n = 0;
    while (**p && **p != '"') {
        char c = *(*p)++;
        if (c == '\\') {
            char esc = *(*p)++;
            if (!esc) { free(buf); return false; }
            switch (esc) {
                case '"': case '\\': case '/': buf[n++] = esc; break;
                case 'b': buf[n++] = '\b'; break; case 'f': buf[n++] = '\f'; break;
                case 'n': buf[n++] = '\n'; break; case 'r': buf[n++] = '\r'; break;
                case 't': buf[n++] = '\t'; break;
                case 'u': {
                    int h0 = hexVal((*p)[0]), h1 = hexVal((*p)[1]), h2 = hexVal((*p)[2]), h3 = hexVal((*p)[3]);
                    if (h0 < 0 || h1 < 0 || h2 < 0 || h3 < 0) { free(buf); return false; }
                    char utf8[4]; size_t written = encodeUtf8((unsigned int)((h0<<12)|(h1<<8)|(h2<<4)|h3), utf8);
                    for (size_t i = 0; i < written; i++) buf[n++] = utf8[i];
                    *p += 4; break;
                }
                default: buf[n++] = esc; break;
            }
        } else { buf[n++] = c; }
    }
    if (**p != '"') { free(buf); return false; }
    (*p)++; buf[n] = '\0'; *out = buf; return true;
}
static void normalizeOverescapedQuotes(char *s) {
    char *r, *w;
    if (!s) return;
    r = s; w = s;
    while (*r) {
        if (r[0] == '\\' && r[1] == '"') { *w++ = '"'; r += 2; continue; }
        *w++ = *r++;
    }
    *w = '\0';
}
static void appendJsonTranslation(char *en, char *zh) {
    DynamicTranslationPair *next = (DynamicTranslationPair *) realloc(
        jsonTranslations, sizeof(DynamicTranslationPair) * (jsonTranslationCount + 1));
    jsonTranslations = next;
    jsonTranslations[jsonTranslationCount].en = en;
    jsonTranslations[jsonTranslationCount].zh = zh;
    jsonTranslationCount++;
}

static const char *skipColorEscapes(const char *s) {
    while ((unsigned char)*s == COLOR_ESCAPE) s += 4;
    return s;
}

static boolean compareCharSkipColorEscapes(const char **srcPtr, char expected) {
    const char *s = skipColorEscapes(*srcPtr);
    if (*s != expected) return false;
    *srcPtr = s + 1;
    return true;
}

static const char *strnstrHelperSkipColor(const char *haystack, const char *needle, size_t needleLen) {
    if (needleLen == 0) return haystack;
    for (; *haystack; ) {
        const char *h = skipColorEscapes(haystack);
        if (*h == '\0') break;
        if (strncmp(h, needle, needleLen) == 0) return haystack;
        if ((unsigned char)*haystack == COLOR_ESCAPE) haystack += 4;
        else haystack++;
    }
    return NULL;
}

static size_t sourceLengthSkipColor(const char *start, const char *end) {
    size_t len = 0;
    while (start < end) {
        if ((unsigned char)*start == COLOR_ESCAPE) start += 4;
        else { start++; len++; }
    }
    return len;
}

static size_t parsePrintfTokenLength(const char *s) {
    size_t i = 1;
    if (!s[0] || s[0] != '%') return 0;
    if (s[1] == '%') return 2;
    while (s[i] && strchr("0123456789$-+0# .", s[i])) i++;
    if (s[i] == '.' || (s[i] >= '0' && s[i] <= '9')) {
        while (s[i] && (s[i] == '.' || (s[i] >= '0' && s[i] <= '9'))) i++;
    }
    if (strchr("hljztL", s[i])) { i++; if (s[i-1] == 'h' && s[i] == 'h') i++; else if (s[i-1] == 'l' && s[i] == 'l') i++; }
    if (!s[i] || !strchr("diuoxXfFeEgGaAcCsSpn", s[i])) return 0;
    return i + 1;
}

static char *dupString(const char *s) {
    size_t n = strlen(s);
    char *d = (char *) malloc(n + 1);
    if (!d) return NULL;
    memcpy(d, s, n + 1);
    return d;
}

static boolean templateMatch(const char *tmpl, const char *src, char **captures, int *captureCount, int maxCaptures) {
    const char *t = tmpl;
    const char *s = src;
    int count = 0;
    while (*t) {
        if (*t != '%') {
            if (!compareCharSkipColorEscapes(&s, *t)) return false;
            t++;
            continue;
        }
        if (t[1] == '%') {
            if (!compareCharSkipColorEscapes(&s, '%')) return false;
            t += 2;
            continue;
        }
        size_t tokenLen = parsePrintfTokenLength(t);
        if (!tokenLen) return false;
        t += tokenLen;
        const char *nextLiteralStart = t;
        while (*t && *t != '%') t++;
        size_t nextLiteralLen = (size_t) (t - nextLiteralStart);
        if (count >= maxCaptures) return false;
        if (nextLiteralLen == 0) {
            const char *srcStart = s;
            while (*s) { if ((unsigned char)*s == COLOR_ESCAPE) s += 4; else s++; }
            captures[count++] = dupString(srcStart);
            break;
        }
        const char *matchPos = strnstrHelperSkipColor(s, nextLiteralStart, nextLiteralLen);
        if (!matchPos) return false;
        size_t capLen = sourceLengthSkipColor(s, matchPos);
        captures[count] = (char *) malloc(capLen + 1);
        char *dest = captures[count];
        while (s < matchPos) {
            if ((unsigned char)*s == COLOR_ESCAPE) s += 4;
            else *dest++ = *s++;
        }
        *dest = '\0';
        count++;
        s = matchPos;
        for (size_t i = 0; i < nextLiteralLen; i++) {
            if (!compareCharSkipColorEscapes(&s, nextLiteralStart[i])) {
                free(captures[count-1]); return false;
            }
        }
    }
    while ((unsigned char)*s == COLOR_ESCAPE) s += 4;
    if (*s != '\0') return false;
    *captureCount = count;
    return true;
}

static boolean hasPrintfPlaceholder(const char *s) {
    for (size_t i = 0; s[i]; i++) {
        if ((unsigned char)s[i] == COLOR_ESCAPE) { i += 3; continue; }
        if (s[i] == '%') {
            if (s[i + 1] == '%') { i++; continue; }
            if (parsePrintfTokenLength(&s[i]) > 0) return true;
        }
    }
    return false;
}

int main() {
    FILE *f = fopen("zh_CN.json", "rb");
    fseek(f, 0, SEEK_END); long size = ftell(f); fseek(f, 0, SEEK_SET);
    char *content = (char *) malloc(size + 1);
    fread(content, 1, size, f); content[size] = '\0'; fclose(f);
    const char *p = content; skipWs(&p); p++;
    for (;;) {
        char *key, *value;
        skipWs(&p); if (*p == '}') break;
        if (!parseJsonString(&p, &key)) break;
        skipWs(&p); p++; skipWs(&p);
        if (!parseJsonString(&p, &value)) break;
        normalizeOverescapedQuotes(key); normalizeOverescapedQuotes(value);
        appendJsonTranslation(key, value);
        skipWs(&p); if (*p == ',') p++; else if (*p == '}') break; else break;
    }
    
    char *src = "Zapping your 柳木法杖:";
    char *src2 = "(Your 柳木法杖 must be firebolt 法杖.)";
    printf("hasPrintf %d %d\n", hasPrintfPlaceholder(src), hasPrintfPlaceholder("Zapping your %s:"));
    for(int i=0; i<jsonTranslationCount; i++) {
        if (!strcmp("Zapping your %s:", jsonTranslations[i].en)) {
            char *captures[32] = {0}; int capCount = 0;
            boolean matched = templateMatch(jsonTranslations[i].en, src, captures, &capCount, 32);
            printf("matched 1 = %d\n", matched);
        }
        if (!strcmp("(Your %s must be %s.)", jsonTranslations[i].en)) {
            char *captures[32] = {0}; int capCount = 0;
            boolean matched = templateMatch(jsonTranslations[i].en, src2, captures, &capCount, 32);
            printf("matched 2 = %d\n", matched);
            for(int j=0; j<capCount; j++) printf("Cap%d: '%s'\n", j, captures[j]);
        }
    }
    return 0;
}
