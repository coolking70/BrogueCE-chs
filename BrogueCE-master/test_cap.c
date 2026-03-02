#include <stdio.h>
#include <string.h>

int main() {
    char s[] = "you zap your \x19\x32\x32\x32桉木法杖 at \x19\x32\x32\x32老鼠.";
    printf("%s\n", s);
    return 0;
}
