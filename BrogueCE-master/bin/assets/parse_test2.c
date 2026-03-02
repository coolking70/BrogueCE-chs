#include <ctype.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define BROGUE_FILENAME_MAX 1024
typedef enum { false, true } boolean;

typedef struct DynamicTranslationPair {
  char *en;
  char *zh;
} DynamicTranslationPair;
static DynamicTranslationPair *jsonTranslations = NULL;
static size_t jsonTranslationCount = 0;

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
  if (**p != '"')
    return false;
  (*p)++;
  const char *s = *p;
  size_t cap = strlen(s) + 1;
  char *buf = (char *)malloc(cap);
  size_t n = 0;
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
        int h0 = hexVal((*p)[0]), h1 = hexVal((*p)[1]), h2 = hexVal((*p)[2]),
            h3 = hexVal((*p)[3]);
        if (h0 < 0 || h1 < 0 || h2 < 0 || h3 < 0) {
          free(buf);
          return false;
        }
        char utf8[4];
        size_t written = encodeUtf8(
            (unsigned int)((h0 << 12) | (h1 << 8) | (h2 << 4) | h3), utf8);
        for (size_t i = 0; i < written; i++)
          buf[n++] = utf8[i];
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

int main() {
  FILE *f = fopen("zh_CN.merged.json", "rb");
  if (!f) {
    printf("Failed to open file\n");
    return 1;
  }
  fseek(f, 0, SEEK_END);
  long size = ftell(f);
  fseek(f, 0, SEEK_SET);
  char *content = (char *)malloc(size + 1);
  fread(content, 1, size, f);
  content[size] = '\0';
  fclose(f);
  const char *p = content;
  skipWs(&p);
  if (*p != '{') {
    printf("Missing {\n");
    free(content);
    return 1;
  }
  p++;
  int cnt = 0;
  for (;;) {
    char *key;
    char *value;
    skipWs(&p);
    if (*p == '}')
      break;
    if (!parseJsonString(&p, &key)) {
      printf("Failed to parse key at %ld\n", p - content);
      break;
    }
    skipWs(&p);
    if (*p != ':') {
      printf("Missing : at %ld\n", p - content);
      free(key);
      break;
    }
    p++;
    skipWs(&p);
    if (!parseJsonString(&p, &value)) {
      printf("Failed to parse value for key %s\n", key);
      free(key);
      break;
    }
    normalizeOverescapedQuotes(key);
    normalizeOverescapedQuotes(value);
    appendJsonTranslation(key, value);
    cnt++;
    skipWs(&p);
    if (*p == ',') {
      p++;
      continue;
    }
    if (*p == '}')
      break;
    printf("Unexpected character %c at %ld\n", *p, p - content);
    break;
  }
  printf("Loaded %d translations\n", cnt);
  for (int i = 0; i < cnt; i++) {
    if (strcmp(jsonTranslations[i].en, "Zapping your %s:") == 0) {
      printf("Found Zapping your %%s:\n");
    }
  }
  free(content);
  return 0;
}
