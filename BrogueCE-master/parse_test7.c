#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define COLOR_ESCAPE 25

typedef enum { false, true } boolean;

static const char *skipColorEscapes(const char *s) {
    while ((unsigned char)*s == COLOR_ESCAPE) s += 4;
    return s;
}
static boolean compareCharSkipColorEscapes(const char **srcPtr, char expected) {
    const char *s = skipColorEscapes(*srcPtr);
    if (*s != expected) return false;
    *srcPtr = s + 1; return true;
}
static const char *strnstrHelperSkipColor(const char *haystack, const char *needle, size_t needleLen) {
    if (needleLen == 0) return haystack;
    for (; *haystack; ) {
        const char *h = skipColorEscapes(haystack);
        if (*h == '\0') break;
        if (strncmp(h, needle, needleLen) == 0) return haystack;
        if ((unsigned char)*haystack == COLOR_ESCAPE) haystack += 4; else haystack++;
    }
    return NULL;
}
static size_t sourceLengthSkipColor(const char *start, const char *end) {
    size_t len = 0;
    while (start < end) {
        if ((unsigned char)*start == COLOR_ESCAPE) start += 4; else { start++; len++; }
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
    size_t n = strlen(s); char *d = (char *) malloc(n + 1);
    if (!d) return NULL; memcpy(d, s, n + 1); return d;
}

static boolean templateMatch(const char *tmpl, const char *src, char **captures, int *captureCount, int maxCaptures) {
    const char *t = tmpl; const char *s = src; int count = 0;
    while (*t) {
        if (*t != '%') { if (!compareCharSkipColorEscapes(&s, *t)) return false; t++; continue; }
        if (t[1] == '%') { if (!compareCharSkipColorEscapes(&s, '%')) return false; t += 2; continue; }
        size_t tokenLen = parsePrintfTokenLength(t);
        if (!tokenLen) return false;
        t += tokenLen;
        const char *nextLiteralStart = t;
        while (*t && *t != '%') t++;
        size_t nextLiteralLen = (size_t)(t - nextLiteralStart);
        if (count >= maxCaptures) return false;
        if (nextLiteralLen == 0) {
            const char *srcStart = s;
            while (*s) { if ((unsigned char)*s == COLOR_ESCAPE) s += 4; else s++; }
            captures[count++] = dupString(srcStart); break;
        }
        const char *matchPos = strnstrHelperSkipColor(s, nextLiteralStart, nextLiteralLen);
        if (!matchPos) return false;
        size_t capLen = sourceLengthSkipColor(s, matchPos);
        captures[count] = (char *) malloc(capLen + 1);
        char *dest = captures[count];
        while (s < matchPos) { if ((unsigned char)*s == COLOR_ESCAPE) s += 4; else *dest++ = *s++; }
        *dest = '\0'; count++; s = matchPos;
        for (size_t i = 0; i < nextLiteralLen; i++) { if (!compareCharSkipColorEscapes(&s, nextLiteralStart[i])) { free(captures[count-1]); return false; } }
    }
    while ((unsigned char)*s == COLOR_ESCAPE) s += 4;
    if (*s != '\0') return false;
    *captureCount = count;
    return true;
}

int main(void) {
    char *captures[32] = {0}; int capCount = 0;
    char src[200];
    sprintf(src, "you zap your %c%c%c%c桉木法杖 at %c%c%c%c老鼠.", 25, 50, 50, 50, 25, 50, 50, 50);

    boolean res = templateMatch("you zap your %s at %s.", src, captures, &capCount, 32);
    printf("match: %d, count: %d\n", res, capCount);
    for(int i=0; i<capCount; i++) {
        printf("cap: %s\n", captures[i]);
    }
    return 0;
}
