
#include <stdio.h>
#include <stdbool.h>
#include <stdlib.h>
#include <string.h>
typedef bool boolean;
typedef struct {short x,y;} pos;
#define DCOLS 9
#define DROWS 9
#define INVALID_POS ((pos){-1,-1})
#define PDS_CELL(m,x,y) (&(m)->links[(x)+DCOLS*(y)])
#define PDS_OBSTRUCTION -2
#define PDS_FORBIDDEN -1
#define T_OBSTRUCTS_PASSABILITY 1
#define T_OBSTRUCTS_DIAGONAL_MOVEMENT 2
#define max(a,b) ((a)>(b)?(a):(b))
#define brogueAssert(x) do {if(!(x)) abort();} while(0)
const short nbDirs[8][2]={{0,-1},{0,1},{-1,0},{1,0},{-1,-1},{-1,1},{1,-1},{1,1}};
struct cell {unsigned long flags,terrain;short layers[4];} pmap[DCOLS][DROWS];
#define LIQUID 1
#define NOTHING 0
#define pmapAt(p) (&pmap[(p).x][(p).y])
boolean coordinatesAreInMap(int x,int y){return x>=0&&y>=0&&x<DCOLS&&y<DROWS;}
boolean isPosInMap(pos p){return coordinatesAreInMap(p.x,p.y);}
boolean cellHasTerrainFlag(pos p,unsigned long f){return !!(pmapAt(p)->terrain&f);}
int passableArcCount(int x,int y){return 0;}
short **allocGrid(){short **g=malloc(DCOLS*sizeof(*g));for(int x=0;x<DCOLS;x++)g[x]=calloc(DROWS,sizeof(**g));return g;}
void freeGrid(short **g){for(int x=0;x<DCOLS;x++)free(g[x]);free(g);}
void fillGrid(short **g,short v){for(int x=0;x<DCOLS;x++)for(int y=0;y<DROWS;y++)g[x][y]=v;}
void getTerrainGrid(short **g,short v,unsigned long t,unsigned long f){for(int x=0;x<DCOLS;x++)for(int y=0;y<DROWS;y++)if((pmap[x][y].terrain&t)||(pmap[x][y].flags&f))g[x][y]=v;}
void getPassableArcGrid(short **g,int a,int b,int c){}
void findReplaceGrid(short **g,short lo,short hi,short v){for(int x=0;x<DCOLS;x++)for(int y=0;y<DROWS;y++)if(g[x][y]>=lo&&g[x][y]<=hi)g[x][y]=v;}
short validLocationCount(short **g,short v){short count=0;for(int x=0;x<DCOLS;x++)for(int y=0;y<DROWS;y++)if(g[x][y]==v)count++;return count;}
int choice;
short rand_range(int lo,int hi){return lo+choice%(hi-lo+1);}

typedef struct pdsLink {
    short distance;
    short cost;
    struct pdsLink *left;
    struct pdsLink *right;
} pdsLink;

typedef struct pdsMap {
    pdsLink front;
    pdsLink links[DCOLS * DROWS];
} pdsMap;

static void pdsUpdate(pdsMap *map, boolean useDiagonals) {
    short dirs = useDiagonals ? 8 : 4;

    pdsLink *head = map->front.right;
    map->front.right = NULL;

    while (head != NULL) {
        for (short dir = 0; dir < dirs; dir++) {
            pdsLink *link = head + (nbDirs[dir][0] + DCOLS * nbDirs[dir][1]);
            if (link < map->links || link >= map->links + DCOLS * DROWS) continue;

            // verify passability
            if (link->cost < 0) continue;
            if (dir >= 4) {
                pdsLink *way1 = head + nbDirs[dir][0];
                pdsLink *way2 = head + DCOLS * nbDirs[dir][1];
                if (way1->cost == PDS_OBSTRUCTION || way2->cost == PDS_OBSTRUCTION) continue;
            }

            if (head->distance + link->cost < link->distance) {
                link->distance = head->distance + link->cost;

                // reinsert the touched cell; it'll be close to the beginning of the list now, so
                // this will be very fast.  start by removing it.

                if (link->right != NULL) link->right->left = link->left;
                if (link->left != NULL) link->left->right = link->right;

                pdsLink *left = head;
                pdsLink *right = head->right;
                while (right != NULL && right->distance < link->distance) {
                    left = right;
                    right = right->right;
                }
                if (left != NULL) left->right = link;
                link->right = right;
                link->left = left;
                if (right != NULL) right->left = link;
            }
        }

        pdsLink *right = head->right;

        head->left = NULL;
        head->right = NULL;

        head = right;
    }
}

static void pdsClear(pdsMap *map, short maxDistance) {
    map->front.right = NULL;

    for (int i=0; i < DCOLS*DROWS; i++) {
        map->links[i].distance = maxDistance;
        map->links[i].left = NULL;
        map->links[i].right = NULL;
    }
}

static void pdsSetDistance(pdsMap *map, short x, short y, short distance) {
    if (x > 0 && y > 0 && x < DCOLS - 1 && y < DROWS - 1) {
        pdsLink *link = PDS_CELL(map, x, y);
        if (link->distance > distance) {
            link->distance = distance;

            if (link->right != NULL) link->right->left = link->left;
            if (link->left != NULL) link->left->right = link->right;

            pdsLink *left = &map->front;
            pdsLink *right = map->front.right;

            while (right != NULL && right->distance < link->distance) {
                left = right;
                right = right->right;
            }

            link->right = right;
            link->left = left;
            left->right = link;
            if (right != NULL) right->left = link;
        }
    }
}

static void pdsBatchInput(pdsMap *map, short **distanceMap, short **costMap, short maxDistance) {
    pdsLink *left = NULL;
    pdsLink *right = NULL;

    map->front.right = NULL;
    for (int i=0; i<DCOLS; i++) {
        for (int j=0; j<DROWS; j++) {
            pdsLink *link = PDS_CELL(map, i, j);

            if (distanceMap != NULL) {
                link->distance = distanceMap[i][j];
            } else {
                if (costMap != NULL) {
                    // totally hackish; refactor
                    link->distance = maxDistance;
                }
            }

            int cost;

            if (i == 0 || j == 0 || i == DCOLS - 1 || j == DROWS - 1) {
                cost = PDS_OBSTRUCTION;
            } else if (costMap == NULL) {
                if (cellHasTerrainFlag((pos){ i, j }, T_OBSTRUCTS_PASSABILITY) && cellHasTerrainFlag((pos){ i, j }, T_OBSTRUCTS_DIAGONAL_MOVEMENT)) cost = PDS_OBSTRUCTION;
                else cost = PDS_FORBIDDEN;
            } else {
                cost = costMap[i][j];
            }

            link->cost = cost;

            if (cost > 0) {
                if (link->distance < maxDistance) {
                    if (right == NULL || right->distance > link->distance) {
                        // left and right are used to traverse the list; if many cells have similar values,
                        // some time can be saved by not clearing them with each insertion.  this time,
                        // sadly, we have to start from the front.

                        left = &map->front;
                        right = map->front.right;
                    }

                    while (right != NULL && right->distance < link->distance) {
                        left = right;
                        right = right->right;
                    }

                    link->right = right;
                    link->left = left;
                    left->right = link;
                    if (right != NULL) right->left = link;

                    left = link;
                } else {
                    link->right = NULL;
                    link->left = NULL;
                }
            } else {
                link->right = NULL;
                link->left = NULL;
            }
        }
    }
}

static void pdsBatchOutput(pdsMap *map, short **distanceMap, boolean useDiagonals) {
    pdsUpdate(map, useDiagonals);
    // transfer results to the distanceMap
    for (int i=0; i<DCOLS; i++) {
        for (int j=0; j<DROWS; j++) {
            distanceMap[i][j] = PDS_CELL(map, i, j)->distance;
        }
    }
}

void dijkstraScan(short **distanceMap, short **costMap, boolean useDiagonals) {
    static pdsMap map;

    pdsBatchInput(&map, distanceMap, costMap, 30000);
    pdsBatchOutput(&map, distanceMap, useDiagonals);
}

boolean getQualifyingLocNear(pos *loc,
                             pos target,
                             boolean hallwaysAllowed,
                             char blockingMap[DCOLS][DROWS],
                             unsigned long forbiddenTerrainFlags,
                             unsigned long forbiddenMapFlags,
                             boolean forbidLiquid,
                             boolean deterministic) {
    short candidateLocs = 0;

    // count up the number of candidate locations
    for (int k=0; k<max(DROWS, DCOLS) && !candidateLocs; k++) {
        for (int i = target.x-k; i <= target.x+k; i++) {
            for (int j = target.y-k; j <= target.y+k; j++) {
                if (coordinatesAreInMap(i, j)
                    && (i == target.x-k || i == target.x+k || j == target.y-k || j == target.y+k)
                    && (!blockingMap || !blockingMap[i][j])
                    && !cellHasTerrainFlag((pos){ i, j }, forbiddenTerrainFlags)
                    && !(pmap[i][j].flags & forbiddenMapFlags)
                    && (!forbidLiquid || pmap[i][j].layers[LIQUID] == NOTHING)
                    && (hallwaysAllowed || passableArcCount(i, j) < 2)) {
                    candidateLocs++;
                }
            }
        }
    }

    if (candidateLocs == 0) {
        return false;
    }

    // and pick one
    short randIndex;
    if (deterministic) {
        randIndex = 1 + candidateLocs / 2;
    } else {
        randIndex = rand_range(1, candidateLocs);
    }

    for (int k=0; k<max(DROWS, DCOLS); k++) {
        for (int i = target.x-k; i <= target.x+k; i++) {
            for (int j = target.y-k; j <= target.y+k; j++) {
                if (coordinatesAreInMap(i, j)
                    && (i == target.x-k || i == target.x+k || j == target.y-k || j == target.y+k)
                    && (!blockingMap || !blockingMap[i][j])
                    && !cellHasTerrainFlag((pos){ i, j }, forbiddenTerrainFlags)
                    && !(pmap[i][j].flags & forbiddenMapFlags)
                    && (!forbidLiquid || pmap[i][j].layers[LIQUID] == NOTHING)
                    && (hallwaysAllowed || passableArcCount(i, j) < 2)) {
                    if (--randIndex == 0) {
                        *loc = (pos){ .x = i, .y = j };
                        return true;
                    }
                }
            }
        }
    }

    brogueAssert(false);
    return false; // should never reach this point
}

static short leastPositiveValueInGrid(short **grid) {
    short i, j, leastPositiveValue = 0;
    for(i = 0; i < DCOLS; i++) {
        for(j = 0; j < DROWS; j++) {
            if (grid[i][j] > 0 && (leastPositiveValue == 0 || grid[i][j] < leastPositiveValue)) {
                leastPositiveValue = grid[i][j];
            }
        }
    }
    return leastPositiveValue;
}

// Takes a grid as a mask of valid locations, chooses one randomly and returns it as (x, y).
// If there are no valid locations, returns (-1, -1).
void randomLocationInGrid(short **grid, short *x, short *y, short validValue) {
    const short locationCount = validLocationCount(grid, validValue);
    short i, j;

    if (locationCount <= 0) {
        *x = *y = -1;
        return;
    }
    short index = rand_range(0, locationCount - 1);
    for(i = 0; i < DCOLS && index >= 0; i++) {
        for(j = 0; j < DROWS && index >= 0; j++) {
            if (grid[i][j] == validValue) {
                if (index == 0) {
                    *x = i;
                    *y = j;
                }
                index--;
            }
        }
    }
    return;
}

// Finds the lowest positive number in a grid, chooses one location with that number randomly and returns it as (x, y).
// If there are no valid locations, returns INVALID_POS, aka (-1, -1).
static pos randomLeastPositiveLocationInGrid(short **grid, boolean deterministic) {
    const short targetValue = leastPositiveValueInGrid(grid);

    if (targetValue == 0) {
        return INVALID_POS;
    }

    short locationCount = 0;
    for(int i = 0; i < DCOLS; i++) {
        for(int j = 0; j < DROWS; j++) {
            if (grid[i][j] == targetValue) {
                locationCount++;
            }
        }
    }

    short index;
    if (deterministic) {
        index = locationCount / 2;
    } else {
        index = rand_range(0, locationCount - 1);
    }

    for(int i = 0; i < DCOLS && index >= 0; i++) {
        for(int j = 0; j < DROWS && index >= 0; j++) {
            if (grid[i][j] == targetValue) {
                if (index == 0) {
                    return (pos){ .x = i, .y = j };
                }
                index--;
            }
        }
    }
    // This should not be reachable, since we should have already hit
    // the unique 'index == 0' point.
    return INVALID_POS;
}

pos getQualifyingPathLocNear(
    pos target,
    boolean hallwaysAllowed,
    unsigned long blockingTerrainFlags,
    unsigned long blockingMapFlags,
    unsigned long forbiddenTerrainFlags,
    unsigned long forbiddenMapFlags,
    boolean deterministic
) {
    short **grid, **costMap;

    // First check the given location to see if it works, as an optimization.
    if (!cellHasTerrainFlag(target, blockingTerrainFlags | forbiddenTerrainFlags)
        && !(pmapAt(target)->flags & (blockingMapFlags | forbiddenMapFlags))
        && (hallwaysAllowed || passableArcCount(target.x, target.y) <= 1)) {

        return target;
    }

    // Allocate the grids.
    grid = allocGrid();
    costMap = allocGrid();

    // Start with a base of a high number everywhere.
    fillGrid(grid, 30000);
    fillGrid(costMap, 1);

    // Block off the pathing blockers.
    getTerrainGrid(costMap, PDS_FORBIDDEN, blockingTerrainFlags, blockingMapFlags);
    if (blockingTerrainFlags & (T_OBSTRUCTS_DIAGONAL_MOVEMENT | T_OBSTRUCTS_PASSABILITY)) {
        getTerrainGrid(costMap, PDS_OBSTRUCTION, T_OBSTRUCTS_DIAGONAL_MOVEMENT, 0);
    }

    // Run the distance scan.
    grid[target.x][target.y] = 1;
    costMap[target.x][target.y] = 1;
    dijkstraScan(grid, costMap, true);
    findReplaceGrid(grid, 30000, 30000, 0);

    // Block off invalid targets that aren't pathing blockers.
    getTerrainGrid(grid, 0, forbiddenTerrainFlags, forbiddenMapFlags);
    if (!hallwaysAllowed) {
        getPassableArcGrid(grid, 2, 10, 0);
    }

    // Get the solution.
    pos retLoc = randomLeastPositiveLocationInGrid(grid, deterministic);

//    dumpLevelToScreen();
//    displayGrid(grid);
//    if (coordinatesAreInMap(*retValX, *retValY)) {
//        hiliteCell(*retValX, *retValY, &yellow, 100, true);
//    }
//    temporaryMessage("Qualifying path selected:", REQUIRE_ACKNOWLEDGMENT);

    freeGrid(grid);
    freeGrid(costMap);

    // Fall back to a pathing-agnostic alternative if there are no solutions.
    if (isPosInMap(retLoc)) {
        return retLoc;
    }
    
    pos loc;
    if (getQualifyingLocNear(&loc, target, hallwaysAllowed, NULL,
                                (blockingTerrainFlags | forbiddenTerrainFlags),
                                (blockingMapFlags | forbiddenMapFlags),
                                false, deterministic)) {
        return loc;
    } else {
        return retLoc;
    }
    
}


int main(){puts("[");for(int seed=0;seed<128;seed++) {
 unsigned state=seed+1;int cells[81];
 for(int x=0;x<9;x++)for(int y=0;y<9;y++){state=state*1664525u+1013904223u;int n=(state>>16)%6;if(!x||!y||x==8||y==8)n=1;cells[x*9+y]=n;pmap[x][y].terrain=n==1?7:n==2?8:n==3?16:0;pmap[x][y].flags=n==4?1:0;}
 for(int mode=0;mode<2;mode++) {pos origin={(seed%7)+1,((seed/7)%7)+1};unsigned long blocking=mode?1|8|16:1|8, forbidden=mode?0:4;int seen[81]={0};
 for(choice=0;choice<81;choice++){pos p=getQualifyingPathLocNear(origin,true,blocking,0,forbidden,1,false);if(isPosInMap(p))seen[p.x*9+p.y]=1;}
 printf("%s{\"seed\":%d,\"mode\":%d,\"origin\":[%d,%d],\"cells\":[",seed||mode?",":"",seed,mode,origin.x,origin.y);
 for(int i=0;i<81;i++)printf("%s%d",i?",":"",cells[i]);printf("],\"candidates\":[");int first=1;for(int i=0;i<81;i++)if(seen[i]){printf("%s[%d,%d]",first?"":",",i/9,i%9);first=0;}printf("]}");
 }}puts("]");}
