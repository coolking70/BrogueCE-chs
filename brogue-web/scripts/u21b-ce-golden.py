"""Compile this checkout's Light.c updateMinersLightRadius verbatim with small CE stubs."""
from pathlib import Path
import subprocess
import tempfile

root = Path(__file__).resolve().parents[2]
light = (root / 'BrogueCE-master/src/brogue/Light.c').read_text(encoding='utf-8')
start = light.index('void updateMinersLightRadius() {')
end = light.index('\nstatic void updateDisplayDetail()', start)
original = light[start:end]
prefix = r'''
#include <stdio.h>
#define FP_FACTOR 65536
#define STATUS_DARKNESS 0
#define clamp(x,a,b) ((x)<(a)?(a):((x)>(b)?(b):(x)))
#define max(a,b) ((a)>(b)?(a):(b))
#define min(a,b) ((a)<(b)?(a):(b))
typedef long long fixpt;
struct { int status[1], maxStatus[1]; } player;
struct { fixpt minersLightRadius; int lightMultiplier, inWater;
         struct { int radialFadeToPercent; struct { int lowerBound, upperBound; } lightRadius; } minersLight;
       } rogue;
'''
suffix = r'''
int main(void) {
  int depths[] = {1,2,5,10,20,26,40};
  for (int i=0;i<7;i++) {
    int d=depths[i];
    rogue.minersLightRadius=(79-1)*FP_FACTOR;
    for (int j=0;j<d;j++) rogue.minersLightRadius=rogue.minersLightRadius*85/100;
    rogue.minersLightRadius+=FP_FACTOR*225/100;
    for (int k=0;k<5;k++) {
      rogue.lightMultiplier=(int[]){1,1,1,3,-2}[k];
      player.status[0]=(int[]){0,400,200,0,0}[k];
      player.maxStatus[0]=400;
      rogue.inWater=(int[]){0,0,1,0,0}[k];
      updateMinersLightRadius();
      printf("%d,%d,%d,%d,%d,%d\n",d,rogue.lightMultiplier,player.status[0],rogue.inWater,
          rogue.minersLight.lightRadius.lowerBound,rogue.minersLight.radialFadeToPercent);
    }
  }
  rogue.minersLightRadius=(79-1)*FP_FACTOR;
  rogue.minersLightRadius=rogue.minersLightRadius*85/100;
  rogue.minersLightRadius+=FP_FACTOR*225/100;
  rogue.lightMultiplier=1;
  rogue.inWater=0;
  player.status[0]=5;
  player.maxStatus[0]=15;
  updateMinersLightRadius();
  printf("1,1,5/15,0,%d,%d\n",rogue.minersLight.lightRadius.lowerBound,
      rogue.minersLight.radialFadeToPercent);
}
'''
with tempfile.TemporaryDirectory() as tmp:
    source = Path(tmp) / 'golden.c'
    exe = Path(tmp) / 'golden.exe'
    source.write_text(prefix + original + suffix, encoding='utf-8')
    subprocess.run(['clang', '-std=c11', '-O0', str(source), '-o', str(exe)], check=True)
    subprocess.run([str(exe)], check=True)
