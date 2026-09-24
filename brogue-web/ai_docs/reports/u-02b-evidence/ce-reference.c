#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <time.h>
#include <assert.h>
#define RNG_SUBSTANTIVE 0
#define RNG_COSMETIC 1
#define brogueAssert assert
#define DCOLS 79
#define DROWS 29
typedef struct {short x,y;} pos;
struct { int RNG; uint64_t seed; } rogue;
unsigned long randomNumbersGenerated;
struct {int deepestLevel;} constants={40}, *gameConst=&constants;
struct {uint64_t levelSeed; pos upStairsLoc,downStairsLoc;} levels[41];
short distanceBetween(pos a,pos b){int x=abs(a.x-b.x),y=abs(a.y-b.y);return x>y?x:y;}
typedef uint32_t u4;
typedef struct ranctx { u4 a; u4 b; u4 c; u4 d; } ranctx;

static ranctx RNGState[2];

#define rot(x,k) (((x)<<(k))|((x)>>(32-(k))))
static u4 ranval( ranctx *x ) {
    u4 e = x->a - rot(x->b, 27);
    x->a = x->b ^ rot(x->c, 17);
    x->b = x->c + x->d;
    x->c = x->d + e;
    x->d = e + x->a;
    return x->d;
}

static void raninit( ranctx *x, uint64_t seed ) {
    u4 i;
    x->a = 0xf1ea5eed, x->b = x->c = x->d = (u4)seed;
    x->c ^= (u4)(seed >> 32);
    for (i=0; i<20; ++i) {
        (void)ranval(x);
    }
}

/* ----------------------------------------------------------------------
 range

 returns a number between 0 and N-1
 without any bias.

 */

#define RAND_MAX_COMBO ((unsigned long) UINT32_MAX)

static long range(long n, short RNG) {
    unsigned long div;
    long r;

    div = RAND_MAX_COMBO/n;

    do {
        r = ranval(&(RNGState[RNG])) / div;
    } while (r >= n);

    return r;
}

// Get a random int between lowerBound and upperBound, inclusive, with uniform probability distribution

#ifdef AUDIT_RNG // debug version
long rand_range(long lowerBound, long upperBound) {
    int retval;
    char RNGMessage[100];
    if (upperBound <= lowerBound) {
        return lowerBound;
    }
    long interval = upperBound - lowerBound + 1;
    brogueAssert(interval > 1); // to verify that we didn't wrap around
    retval = lowerBound + range(interval, rogue.RNG);
    if (rogue.RNG == RNG_SUBSTANTIVE) {
        randomNumbersGenerated++;
        if (1) { //randomNumbersGenerated >= 1128397) {
            sprintf(RNGMessage, "\n#%lu, %ld to %ld: %ld", randomNumbersGenerated, lowerBound, upperBound, retval);
            RNGLog(RNGMessage);
        }
    }
    return retval;
}
#else // normal version
long rand_range(long lowerBound, long upperBound) {
    if (upperBound <= lowerBound) {
        return lowerBound;
    }
    if (rogue.RNG == RNG_SUBSTANTIVE) {
        randomNumbersGenerated++;
    }
    long interval = upperBound - lowerBound + 1;
    brogueAssert(interval > 1); // to verify that we didn't wrap around
    return lowerBound + range(interval, rogue.RNG);
}
#endif

uint64_t rand_64bits() {
    if (rogue.RNG == RNG_SUBSTANTIVE) {
        randomNumbersGenerated++;
    }
    uint64_t hi = ranval(&(RNGState[rogue.RNG]));
    uint64_t lo = ranval(&(RNGState[rogue.RNG]));
    return (hi << 32) | lo;
}

// seeds with the time if called with a parameter of 0; returns the seed regardless.
// All RNGs are seeded simultaneously and identically.
uint64_t seedRandomGenerator(uint64_t seed) {
    if (seed == 0) {
        seed = (uint64_t) time(NULL) - 1352700000;
    }
    raninit(&(RNGState[RNG_SUBSTANTIVE]), seed);
    raninit(&(RNGState[RNG_COSMETIC]), seed);
    return seed;
}



int main(int argc,char **argv){
 rogue.seed=strtoull(argv[1],NULL,10); seedRandomGenerator(rogue.seed);
 printf("{\"seed\":\"%llu\",\"initial\":[",(unsigned long long)rogue.seed);
 for(int j=0;j<2;j++){ranctx r=RNGState[j];printf("%s[%u,%u,%u,%u]",j?",":"",r.a,r.b,r.c,r.d);}
 printf("],\"raw64\":[");
 for(int j=0;j<8;j++){uint64_t v=rand_64bits();printf("%s\"%llu\"",j?",":"",(unsigned long long)v);}
 seedRandomGenerator(rogue.seed); randomNumbersGenerated=0;
 levels[0].upStairsLoc=(pos){(DCOLS-1)/2-1,DROWS-2};
 printf("],\"levels\":[");
 for(int i=0;i<41;i++){
        if (rogue.seed >> 32) {
            // generate a 64-bit seed
            levels[i].levelSeed = rand_64bits();
        } else {
            // backward-compatible seed
            levels[i].levelSeed = (unsigned long) rand_range(0, 9999);
            levels[i].levelSeed += (unsigned long) 10000 * rand_range(0, 9999);
        }
        if (levels[i].levelSeed == 0) { // seed 0 is not acceptable
            levels[i].levelSeed = i + 1;
        }

        do {
            levels[i].downStairsLoc.x = rand_range(1, DCOLS - 2);
            levels[i].downStairsLoc.y = rand_range(1, DROWS - 2);
        } while (distanceBetween(levels[i].upStairsLoc, levels[i].downStairsLoc) < DCOLS / 3);
        if (i < gameConst->deepestLevel) {
            levels[i+1].upStairsLoc.x = levels[i].downStairsLoc.x;
            levels[i+1].upStairsLoc.y = levels[i].downStairsLoc.y;
        }
 printf("%s{\"levelSeed\":\"%llu\",\"visited\":false,\"upStairsLoc\":{\"x\":%d,\"y\":%d},\"downStairsLoc\":{\"x\":%d,\"y\":%d}}",i?",":"",(unsigned long long)levels[i].levelSeed,levels[i].upStairsLoc.x,levels[i].upStairsLoc.y,levels[i].downStairsLoc.x,levels[i].downStairsLoc.y);
 }
 ranctx r=RNGState[0];printf("],\"count\":%lu,\"afterTable\":[%u,%u,%u,%u]}\n",randomNumbersGenerated,r.a,r.b,r.c,r.d);
}
