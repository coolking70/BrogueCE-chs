#include <stdio.h>
#include <stdlib.h>
#include <setjmp.h>
typedef struct {short lowerBound, upperBound, clumpFactor;} randomRange;
short randClumpedRange(short, short, short);
static jmp_buf probe;
static int tape[32], lows[32], highs[32], length, cursor, first;
static short needLow, needHigh;
short rand_range(short lo, short hi) {
    if(cursor==length) {needLow=lo; needHigh=hi; longjmp(probe,1);}
    lows[cursor]=lo; highs[cursor]=hi;
    int result=tape[cursor++];
    if(result<lo || result>hi) abort();
    return result;
}
short randClump(randomRange theRange) {
    return randClumpedRange(theRange.lowerBound, theRange.upperBound, theRange.clumpFactor);
}

// Get a random int between lowerBound and upperBound, inclusive, with probability distribution
// affected by clumpFactor.
short randClumpedRange(short lowerBound, short upperBound, short clumpFactor) {
    if (upperBound <= lowerBound) {
        return lowerBound;
    }
    if (clumpFactor <= 1) {
        return rand_range(lowerBound, upperBound);
    }

    short i, total = 0, numSides = (upperBound - lowerBound) / clumpFactor;

    for(i=0; i < (upperBound - lowerBound) % clumpFactor; i++) {
        total += rand_range(0, numSides + 1);
    }

    for(; i< clumpFactor; i++) {
        total += rand_range(0, numSides);
    }

    return (total + lowerBound);
}


static randomRange range;
static void explore(void) {
    cursor=0;
    if(setjmp(probe)) {
        int lo=needLow, hi=needHigh;
        for(int v=lo;v<=hi;v++) {tape[length++]=v; explore(); --length;}
        return;
    }
    int value=randClump(range);
    if(!first) printf(","); first=0;
    printf("{\"value\":%d,\"calls\":[",value);
    for(int i=0;i<cursor;i++) printf("%s[%d,%d,%d]",i?",":"",lows[i],highs[i],tape[i]);
    printf("]}");
}
int main(int argc,char **argv) {
    if(argc!=4) return 1;
    range=(randomRange){atoi(argv[1]),atoi(argv[2]),atoi(argv[3])};
    first=1;printf("[");explore();printf("]\n");return 0;
}
