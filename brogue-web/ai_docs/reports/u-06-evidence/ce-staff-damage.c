#include <stdio.h>
typedef long long fixpt;
#define FP_BASE 16 // Don't change this without recalculating all of the power tables throughout the code!
#define FP_FACTOR (1LL << FP_BASE)
long tuple; int calls, lows[16], highs[16];
long rand_range(long lo, long hi) {
    lows[calls]=lo; highs[calls++]=hi;
    long n=lo+tuple%(hi-lo+1); tuple/=hi-lo+1; return n;
}
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
short staffDamageLow(fixpt enchant)            {return ((int) ((2 + enchant / FP_FACTOR) * 3 / 4));}
short staffDamageHigh(fixpt enchant)           {return ((int) (4 + (5 * enchant / FP_FACTOR / 2)));}
short staffDamage(fixpt enchant)               {return ((int) randClumpedRange(staffDamageLow(enchant), staffDamageHigh(enchant), 1 + (enchant) / 3 / FP_FACTOR));}
int main(void) {
    int magnitudes[]={1,4,18};
    for(int i=0;i<3;i++) {
        int e=magnitudes[i], counts[256]={0}; calls=0; tuple=0;
        int low=staffDamage(e*FP_FACTOR); long total=1; int dice=calls;
        printf("%d %d %d %d",e,staffDamageLow(e*FP_FACTOR),staffDamageHigh(e*FP_FACTOR),dice);
        for(int j=0;j<dice;j++){total*=highs[j]-lows[j]+1;printf(" %d %d",lows[j],highs[j]);}
        for(long n=0;n<total;n++){tuple=n;calls=0;counts[staffDamage(e*FP_FACTOR)]++;}
        printf(" %ld",total);
        for(int v=low;v<=staffDamageHigh(e*FP_FACTOR);v++)printf(" %d",counts[v]);
        printf("\n");
    }
}
