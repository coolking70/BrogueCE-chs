#include <stdio.h>
#include <stdint.h>
typedef int64_t fixpt;
#define FP_FACTOR 65536
short staffBladeCount(fixpt enchant)           {return ((int) (enchant * 3 / 2 / FP_FACTOR));}
int main(void) { for(int q=0;q<=80;q++) printf("%d %d\n",q*16384,staffBladeCount((fixpt)q*16384)); }
