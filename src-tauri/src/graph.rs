//! Commit graph lane layout.
//!
//! Input: commits in display order (children before parents).
//! Output per row: the lane of the commit node plus line segments.
//! `up` segments go from the top of the row to its middle,
//! `down` segments go from the middle to the bottom.
//! A segment is `[from_lane, to_lane, color]`.
//! Lanes never shift sideways, so lines that pass through stay straight.

pub struct Row {
    pub lane: u16,
    pub color: u16,
    pub up: Vec<[u16; 3]>,
    pub down: Vec<[u16; 3]>,
}

fn alloc<'a>(lanes: &mut Vec<Option<&'a str>>, colors: &mut Vec<u16>, next: &mut u16) -> usize {
    let i = match lanes.iter().position(|l| l.is_none()) {
        Some(i) => i,
        None => {
            lanes.push(None);
            colors.push(0);
            lanes.len() - 1
        }
    };
    colors[i] = *next;
    *next = next.wrapping_add(1);
    i
}

pub fn layout<'a>(commits: &[(&'a str, Vec<&'a str>)]) -> Vec<Row> {
    let mut lanes: Vec<Option<&'a str>> = Vec::new();
    let mut colors: Vec<u16> = Vec::new();
    let mut next = 0u16;
    let mut rows = Vec::with_capacity(commits.len());

    for (hash, parents) in commits {
        let hash: &'a str = hash;
        let matching: Vec<usize> = lanes
            .iter()
            .enumerate()
            .filter(|(_, l)| **l == Some(hash))
            .map(|(i, _)| i)
            .collect();
        let lane = match matching.first() {
            Some(&i) => i,
            None => alloc(&mut lanes, &mut colors, &mut next),
        };
        let color = colors[lane];

        let mut up = Vec::new();
        let mut through = Vec::new();
        for (j, l) in lanes.iter().enumerate() {
            match l {
                None => {}
                Some(h) if *h == hash => up.push([j as u16, lane as u16, colors[j]]),
                Some(_) => {
                    up.push([j as u16, j as u16, colors[j]]);
                    through.push(j);
                }
            }
        }
        for &j in &matching {
            lanes[j] = None;
        }

        let mut down = Vec::new();
        for (pi, p) in parents.iter().enumerate() {
            let p: &'a str = p;
            if let Some(k) = lanes.iter().position(|l| *l == Some(p)) {
                down.push([lane as u16, k as u16, colors[k]]);
            } else {
                // The first parent continues in this commit's lane.
                let k = if pi == 0 {
                    lane
                } else {
                    alloc(&mut lanes, &mut colors, &mut next)
                };
                lanes[k] = Some(p);
                down.push([lane as u16, k as u16, colors[k]]);
            }
        }
        for j in through {
            down.push([j as u16, j as u16, colors[j]]);
        }
        while lanes.last() == Some(&None) {
            lanes.pop();
            colors.pop();
        }
        rows.push(Row {
            lane: lane as u16,
            color,
            up,
            down,
        });
    }
    rows
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lanes_of(r: &[Row]) -> Vec<u16> {
        r.iter().map(|x| x.lane).collect()
    }

    #[test]
    fn linear_history_uses_one_lane() {
        let c = vec![("c", vec!["b"]), ("b", vec!["a"]), ("a", vec![])];
        let r = layout(&c);
        assert_eq!(lanes_of(&r), vec![0, 0, 0]);
        assert!(r[0].up.is_empty());
        assert_eq!(r[0].down, vec![[0, 0, 0]]);
        assert_eq!(r[1].up, vec![[0, 0, 0]]);
        assert!(r[2].down.is_empty());
    }

    #[test]
    fn branch_and_merge() {
        // m merges f into b; f branched from b.
        let c = vec![
            ("m", vec!["b", "f"]),
            ("f", vec!["b"]),
            ("b", vec!["a"]),
            ("a", vec![]),
        ];
        let r = layout(&c);
        assert_eq!(lanes_of(&r), vec![0, 1, 0, 0]);
        assert_eq!(r[0].down.len(), 2);
        assert_eq!(r[0].down[1][1], 1);
        // f joins back into lane 0, lane 0 passes through.
        assert!(r[1].down.iter().any(|e| e[0] == 1 && e[1] == 0));
        assert!(r[1].down.iter().any(|e| e[0] == 0 && e[1] == 0));
        // Lane 1 is closed after f.
        assert_eq!(r[2].up, vec![[0, 0, r[2].color]]);
    }

    #[test]
    fn two_tips_share_a_parent() {
        let c = vec![("x", vec!["a"]), ("y", vec!["a"]), ("a", vec![])];
        let r = layout(&c);
        assert_eq!(lanes_of(&r), vec![0, 1, 0]);
        assert_ne!(r[0].color, r[1].color);
        assert!(r[1].down.iter().any(|e| e[0] == 1 && e[1] == 0));
    }
}
