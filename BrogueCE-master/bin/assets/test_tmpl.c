
#include <stdio.h>
#include <string.h>
#include <stdbool.h>
#include <stdlib.h>

#define COLOR_ESCAPE '\033'

const char *skipColorEscapes(const char *str) {
    if (!str) return NULL;
    static char buf[2048];
    int j = 0;
    for (int i = 0; str[i] != '\0'; i++) {
        if ((unsigned char)str[i] == COLOR_ESCAPE) {
            i += 4;
        } else {
            buf[j++] = str[i];
        }
    }
    buf[j] = '\0';
    return buf;
}

int sourceLengthSkipColor(const char *start, const char *end) {
    int len = 0;
    while (start < end) {
        if ((unsigned char)*start == COLOR_ESCAPE) {
            start += 4;
        } else {
            len++;
            start++;
        }
    }
    return len;
}

bool compareCharSkipColorEscapes(const char **src, char expected) {
    while ((unsigned char)**src == COLOR_ESCAPE) {
        *src += 4;
    }
    if (**src == expected) {
        (*src)++;
        return true;
    }
    return false;
}

const char *strnstrHelperSkipColor(const char *haystack, const char *needle, size_t needleLen) {
    if (needleLen == 0) return haystack;
    const char *p = haystack;
    while (*p != '\0') {
        const char *h = p;
        const char *n = needle;
        size_t nLen = needleLen;
        bool match = true;
        while (nLen > 0) {
            while ((unsigned char)*h == COLOR_ESCAPE) {
                h += 4;
            }
            if (*h == '\0') {
                match = false;
                break;
            }
            if (*h != *n) {
                match = false;
                break;
            }
            h++;
            n++;
            nLen--;
        }
        if (match) {
            return p;
        }
        if ((unsigned char)*p == COLOR_ESCAPE) {
            p += 4;
        } else {
            p++;
        }
    }
    return NULL;
}

bool templateMatch(const char *tmpl, const char *src, char **captures, int *captureCount, int maxCaptures) {
    const char *placeholder = "%s";
    size_t phLen = 2;
    int count = 0;

    const char *t = tmpl;
    const char *s = src;

    while (*t != '\0') {
        const char *nextPh = strstr(t, placeholder);
        if (!nextPh) {
            while (*t != '\0') {
                if (!compareCharSkipColorEscapes(&s, *t)) {
                    printf("Failed compare literal end: %c vs %s\n", *t, s);
                    return false;
                }
                t++;
            }
            break;
        }

        const char *literal = t;
        size_t literalLen = nextPh - t;

        for (size_t i = 0; i < literalLen; i++) {
            if (!compareCharSkipColorEscapes(&s, literal[i])) {
                printf("Failed compare literal start: %c vs %s\n", literal[i], s);
                return false;
            }
        }

        t = nextPh + phLen;
        const char *nextLiteralStart = t;
        
        char *nextNextPh = strstr(t, placeholder);
        size_t nextLiteralLen = nextNextPh ? (size_t)(nextNextPh - t) : strlen(t);

        if (nextLiteralLen == 0) {
            if (count >= maxCaptures) return false;
            size_t capLen = sourceLengthSkipColor(s, s + strlen(s));
            captures[count] = (char *)malloc(capLen + 1);
            char *dest = captures[count];
            while (*s != '\0') {
                if ((unsigned char)*s == COLOR_ESCAPE) {
                    s += 4;
                } else {
                    *dest++ = *s++;
                }
            }
            *dest = '\0';
            count++;
            break;
        }

        if (count >= maxCaptures) return false;

        const char *matchPos;
        matchPos = strnstrHelperSkipColor(s, nextLiteralStart, nextLiteralLen);
        if (!matchPos) {
            printf("Failed strnstr: %s in %s\n", nextLiteralStart, s);
            return false;
        }

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

        s = matchPos;
        for (size_t i = 0; i < nextLiteralLen; i++) {
            if (!compareCharSkipColorEscapes(&s, nextLiteralStart[i])) {
                printf("Failed compare exact strnstr\n");
                free(captures[count - 1]);
                return false;
            }
        }
        t += nextLiteralLen;
    }

    while ((unsigned char)*s == COLOR_ESCAPE) {
        s += 4;
    }

    if (*s != '\0') {
        printf("Failed string not end! %s\n", s);
        return false;
    }
    *captureCount = count;
    return true;
}

int main() {
    int capCount = 0;
    char *captures[10] = {0};
    bool res = templateMatch("(Your %s must be %s.)", "(Your [3X铬魔杖[0X must be [3Yslowness 魔杖[0Y.)", captures, &capCount, 10);
    printf("Result: %d\n", res);
    for(int i=0; i<capCount; i++) {
         printf("Cap %d: %s\n", i, captures[i]);
    }
    return 0;
}
