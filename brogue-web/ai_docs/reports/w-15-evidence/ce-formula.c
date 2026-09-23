#include <stdio.h>
typedef long long fixpt;
#define FP_FACTOR 65536LL
#define FP_DIV(x,y) ((x)*FP_FACTOR/(y))
fixpt fp_round(fixpt x) {
    long long div = x / FP_FACTOR, rem = x % FP_FACTOR;
    int sign = (x >= 0) - (x < 0);

    if (rem >= FP_FACTOR / 2 || rem <= -FP_FACTOR / 2) {
        return div + sign;
    } else {
        return div;
    }
}
fixpt fp_pow(fixpt base, int expn) {
    if (base == 0) return 0;

    if (expn < 0) {
        base = FP_DIV(FP_FACTOR, base);
        expn = -expn;
    }

    fixpt res = FP_FACTOR, err = 0;
    while (expn--) {
        res = res * base + (err * base) / FP_FACTOR;
        err = res % FP_FACTOR;
        res /= FP_FACTOR;
    }

    return res + fp_round(err);
}
int staffProtection(fixpt enchant) {
    return 130 * fp_pow(FP_FACTOR * 140 / 100, enchant / FP_FACTOR - 2) / FP_FACTOR;
}
int main(){for(int e=0;e<=20;e++)printf("%d %d\n",e,staffProtection(e*FP_FACTOR));}
