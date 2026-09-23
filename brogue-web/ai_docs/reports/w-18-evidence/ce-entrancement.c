#include <stdio.h>
#include <stdint.h>
typedef int64_t fixpt;
#define FP_FACTOR 65536
short staffEntrancementDuration(fixpt enchant) {return ((int) (enchant * 3 / FP_FACTOR));}
int main(void){for(int e=0;e<=50;e++)printf("%d %d\n",e*65536,staffEntrancementDuration(e*65536));
int partial[]={1,21845,21846,65535,65537,152917};for(unsigned i=0;i<sizeof(partial)/sizeof(partial[0]);i++)printf("%d %d\n",partial[i],staffEntrancementDuration(partial[i]));}
