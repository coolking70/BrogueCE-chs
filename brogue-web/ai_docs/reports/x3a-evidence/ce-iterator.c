#include <stdio.h>
#define MB_HAS_DIED 1
typedef int boolean;
typedef struct { int id; int bookkeepingFlags; } creature;
typedef struct creatureListNode { creature *creature; struct creatureListNode *nextCreature; } creatureListNode;
typedef struct { creatureListNode *head; } creatureList;
typedef struct { creatureList *list; creatureListNode *next; } creatureIterator;
creatureIterator iterateCreatures(creatureList *list) {
    creatureIterator iter;
    iter.list = list;
    iter.next = list->head;
    // Skip monsters that have died.
    while (iter.next != NULL && iter.next->creature->bookkeepingFlags & MB_HAS_DIED) {
        iter.next = iter.next->nextCreature;
    }
    return iter;
}
boolean hasNextCreature(creatureIterator iter) {
    return iter.next != NULL;
}
creature *nextCreature(creatureIterator *iter) {
    if (iter->next == NULL) {
        return NULL;
    }
    creature *result = iter->next->creature;
    iter->next = iter->next->nextCreature;
    // Skip monsters that have died.
    while (iter->next != NULL && iter->next->creature->bookkeepingFlags & MB_HAS_DIED) {
        iter->next = iter->next->nextCreature;
    }
    return result;
}
int main(void) {
 puts("[");
 for (int mask = 0; mask < 256; mask++) {
  creature c[8]; creatureListNode n[8];
  for (int i = 0; i < 8; i++) { c[i] = (creature){i, (mask >> i) & 1}; n[i] = (creatureListNode){&c[i], i < 7 ? &n[i+1] : NULL}; }
  creatureList list = { n }; creatureIterator it = iterateCreatures(&list);
  printf("{\"mask\":%d,\"ids\":[", mask); int count = 0;
  while (hasNextCreature(it)) { creature *c = nextCreature(&it); printf("%s%d", count++ ? "," : "", c->id); }
  printf("]}%s\n", mask < 255 ? "," : "");
 }
 puts("]");
}
