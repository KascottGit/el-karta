const COORDINATES = `Coordinates: every point is {x, y} on the image you are given, normalised to 0–1000: x = 0 at the left edge and 1000 at the right edge, y = 0 at the top edge and 1000 at the bottom edge. Boxes are {xmin, ymin, xmax, ymax} in the same coordinates. Report only what you see; never invent values. Use null when something is not printed or not visible.`;

export const LOCATE_SYSTEM = `You read Swedish floor plans, typically from estate agents (mäklare). ${COORDINATES}`;

export const LOCATE_TEXT = `Find the main floor plan drawing on this page: the walls and rooms of the dwelling. Leave out everything around it: legends, the title block, logos, compass roses, site maps (situationsplan, tomtkarta), building sections (sektion), small overview plans of other floors and text blocks. The box should hug the outermost walls of the main plan, including balconies and terraces drawn with it.

Return found = false and box = null if the page holds no floor plan.`;

export const FLOORPLAN_SYSTEM = `You read Swedish floor plans, typically from estate agents (mäklare), and report what is drawn and printed on them as structured data. Code turns your answer into geometry, so precise positions matter more than completeness. ${COORDINATES}`;

export const FLOORPLAN_TEXT = `Report the following.

walls: every wall as a straight centreline segment from a to b. Walls are usually drawn as thick black, grey or coloured bands. A wall continues through its doors and windows: report one segment for the whole straight wall, not pieces between openings. Split a wall only where it turns or ends. exterior = true for the building's outer walls. thickness = the drawn band's width in thousandths of the image width (same units as x), or null if unclear. Ignore furniture, fixtures, hatching, dimension lines and the outline of balconies' railings unless drawn as walls.

openings: doors, windows and open passages in walls. a and b are the two jambs (the ends of the gap in the wall), on the wall's centreline. kind: "door" (a leaf, usually drawn with a quarter-circle swing arc), "window" (thin parallel lines across the wall band) or "passage" (a gap without a door). Double doors, such as double balcony doors, are ONE opening with double = true. hinge: "a" or "b", the jamb the leaf turns about, or null if unclear. swingInto: a point inside the swing arc, i.e. in the room the door opens into, or null. Wardrobe and cupboard doors (marked G, L, ST, K/F or drawn inside wardrobes) are NOT openings.

rooms: one entry per room label printed on the plan. name exactly as printed (for example "Sovrum", "WC/D", "Hall/Kokvrå"); point = the centre of the label text; box = the rough extent of the room around it, or null; area = the printed area in m² if printed in or next to the label ("CA 19 m²" → 19), else null; outdoor = true for Balkong, Terrass, Uteplats. type from the name:
- Sovrum, Sov → bedroom
- Kök, Kokvrå, Kokskåp, Pentry → kitchen
- Vardagsrum, Rum, Allrum, Matrum, Matplats → living_room
- Hall, Entré, Kapprum, Groventré, Trapphall → hallway
- WC, WC/D, D, Dusch, Bad, Badrum, Toalett, WC/dusch → bathroom
- Tvätt, Tvättstuga, Tvättrum → laundry
- Kontor, Arbetsrum → office
- Pannrum, Teknik, Undercentral → technical_room
- Klk (klädkammare), Förråd, Balkong, Terrass, Uteplats, Garage, Bastu and anything else → other
A combined label such as "Hall/Kokvrå" is one room typed by its first word. Abbreviations for fixtures are not rooms: G (garderob), L (linneskåp), ST (städskåp), K/F (kyl/frys), DM (diskmaskin), TM (tvättmaskin), TT (torktumlare), Ugn, Micro.

dimensions: printed dimension texts with the two ends they measure (the ends of the dimension line, or the wall faces it spans). value as a number with a dot as decimal separator ("3,4" → 3.4) and unit: plain numbers such as "3400" are mm, "3,4 m" is m.

scaleBar: a drawn scale bar, with each labelled tick's value and position and the unit, or null.

scaleText: a printed ratio such as "1:100" exactly as printed ("Skala 1:100"), or null. paperSize: the paper size printed with it ("A4", "A3"), or null.

totalArea: a printed total area in m² ("Area ca 23 m²", "BOA 74 m²") or null. ceilingHeight: a printed ceiling height in metres ("rumshöjd ca 2,55 m" → 2.55) or null.

standardObjects: objects whose real size is standard, each with the two ends a and b of one dimension:
- interior_door_leaf: an interior door's leaf, from the hinge to the leaf's free end (the arc's radius)
- entrance_door: the entrance door's leaf, same way
- wardrobe: the width of one wardrobe unit marked G
- kitchen_counter_depth: the depth of a kitchen counter, from the wall to its front edge
- single_bed, double_bed: the length of a drawn bed, head to foot
- toilet: the length of a toilet, from the wall to the front of the bowl
- bathtub: the length of a bathtub
Report the clearest few of each type you see, not every one.`;

export const TILE_NOTE = `This image is one part of a larger plan, cut out with some overlap. Report only what lies inside this image. Walls may run past its edges: end them at the edge. Report a door, window or label only if it is wholly inside.`;
