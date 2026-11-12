//! Small helpers that reproduce the JavaScript semantics the original backend
//! relied on (truthiness, `String(x)`, strict equality). Snapshots and journal
//! entries stay as `serde_json::Value` so existing recovery.json files round-trip
//! exactly, including fields this version does not know about.
use serde_json::Value;

pub fn get<'a>(v: &'a Value, key: &str) -> Option<&'a Value> {
    v.as_object().and_then(|o| o.get(key))
}

pub fn get_str<'a>(v: &'a Value, key: &str) -> Option<&'a str> {
    get(v, key).and_then(Value::as_str)
}

pub fn truthy(v: Option<&Value>) -> bool {
    match v {
        None | Some(Value::Null) => false,
        Some(Value::Bool(b)) => *b,
        Some(Value::Number(n)) => n.as_f64().is_some_and(|f| f != 0.0 && !f.is_nan()),
        Some(Value::String(s)) => !s.is_empty(),
        Some(_) => true,
    }
}

pub fn number_string(n: &serde_json::Number) -> String {
    if let Some(i) = n.as_i64() {
        i.to_string()
    } else if let Some(u) = n.as_u64() {
        u.to_string()
    } else {
        let f = n.as_f64().unwrap_or(f64::NAN);
        if f.is_nan() {
            "NaN".into()
        } else {
            format!("{f}")
        }
    }
}

/// JavaScript `String(value)`.
pub fn js_string(v: Option<&Value>) -> String {
    match v {
        None => "undefined".into(),
        Some(Value::Null) => "null".into(),
        Some(Value::Bool(b)) => b.to_string(),
        Some(Value::Number(n)) => number_string(n),
        Some(Value::String(s)) => s.clone(),
        Some(Value::Array(items)) => items
            .iter()
            .map(|i| match i {
                Value::Null => String::new(),
                other => js_string(Some(other)),
            })
            .collect::<Vec<_>>()
            .join(","),
        Some(Value::Object(_)) => "[object Object]".into(),
    }
}

pub fn num(v: Option<&Value>) -> Option<f64> {
    v.and_then(Value::as_f64)
}

/// `Number.isInteger(value)`.
pub fn is_integer(v: Option<&Value>) -> bool {
    num(v).is_some_and(|f| f.is_finite() && f.fract() == 0.0)
}

/// `a === b` for the primitive values this code compares. Distinct objects and
/// arrays are never strictly equal in JavaScript.
pub fn strict_eq(a: Option<&Value>, b: Option<&Value>) -> bool {
    match (a, b) {
        (None, None) => true,
        (Some(Value::Null), Some(Value::Null)) => true,
        (Some(Value::Bool(x)), Some(Value::Bool(y))) => x == y,
        (Some(Value::Number(x)), Some(Value::Number(y))) => x.as_f64() == y.as_f64(),
        (Some(Value::String(x)), Some(Value::String(y))) => x == y,
        _ => false,
    }
}

/// `JSON.stringify(a) === JSON.stringify(b)`: structural, with numbers compared
/// by value and object keys compared in order.
pub fn json_eq(a: Option<&Value>, b: Option<&Value>) -> bool {
    match (a, b) {
        (None, None) => true,
        (Some(x), Some(y)) => same_json(x, y),
        _ => false,
    }
}

fn same_json(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Number(x), Value::Number(y)) => x.as_f64() == y.as_f64(),
        (Value::Array(x), Value::Array(y)) => {
            x.len() == y.len() && x.iter().zip(y).all(|(p, q)| same_json(p, q))
        }
        (Value::Object(x), Value::Object(y)) => {
            x.len() == y.len()
                && x.iter()
                    .zip(y.iter())
                    .all(|((k1, v1), (k2, v2))| k1 == k2 && same_json(v1, v2))
        }
        _ => a == b,
    }
}

/// Deep equality used by tests and journal checks (key order ignored).
pub fn deep_eq(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Number(x), Value::Number(y)) => x.as_f64() == y.as_f64(),
        (Value::Array(x), Value::Array(y)) => {
            x.len() == y.len() && x.iter().zip(y).all(|(p, q)| deep_eq(p, q))
        }
        (Value::Object(x), Value::Object(y)) => {
            x.len() == y.len()
                && x.iter()
                    .all(|(k, v)| y.get(k).is_some_and(|w| deep_eq(v, w)))
        }
        _ => a == b,
    }
}

/// JavaScript string length in UTF-16 code units.
pub fn js_len(s: &str) -> usize {
    s.encode_utf16().count()
}

pub fn array(v: Option<&Value>) -> Option<&Vec<Value>> {
    v.and_then(Value::as_array)
}
