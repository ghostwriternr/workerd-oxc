use oxc_ast::ast::{
    ArrayExpression, ArrayExpressionElement, Expression, JSXExpression, NumericLiteral,
    ObjectExpression, ObjectPropertyKind, PropertyKey, PropertyKind, StringLiteral,
    TemplateLiteral, UnaryExpression,
};
use oxc_syntax::operator::UnaryOperator;

use crate::payload::{LiteralPropertyFactPayload, LiteralValueFactPayload};

/// Dispatch the shared literal variants across the enums that `@inherit
/// Expression` in oxc (`Expression`, `JSXExpression`, `ArrayExpressionElement`).
/// Non-inherited variants (`EmptyExpression`, `SpreadElement`, `Elision`, ...)
/// fall through to `None`, which correctly makes any containing array/object a
/// non-literal.
macro_rules! literal_from_variants {
    ($expression:expr, $enum:ident) => {
        match $expression {
            $enum::StringLiteral(literal) => Some(literal_string(literal)),
            $enum::NumericLiteral(literal) => literal_number(literal),
            $enum::BooleanLiteral(literal) => Some(LiteralValueFactPayload::Boolean {
                value: literal.value,
            }),
            $enum::NullLiteral(_) => Some(LiteralValueFactPayload::Null),
            $enum::TemplateLiteral(template) => literal_template(template),
            $enum::UnaryExpression(unary) => literal_unary(unary),
            $enum::ArrayExpression(array) => literal_array(array),
            $enum::ObjectExpression(object) => literal_object(object),
            _ => None,
        }
    };
}

/// Structurally materialize a static, JSON-shaped literal value from a JSX
/// expression container. Returns `None` for anything that is not an already
/// literal expression: this is deliberately not a constant evaluator, so it does
/// not resolve identifiers, fold operators (beyond unary `+`/`-` on a numeric
/// literal), or run calls.
pub(crate) fn literal_from_jsx_expression(
    expression: &JSXExpression<'_>,
) -> Option<LiteralValueFactPayload> {
    literal_from_variants!(expression, JSXExpression)
}

fn literal_from_expression(expression: &Expression<'_>) -> Option<LiteralValueFactPayload> {
    literal_from_variants!(expression, Expression)
}

fn literal_from_array_element(
    element: &ArrayExpressionElement<'_>,
) -> Option<LiteralValueFactPayload> {
    literal_from_variants!(element, ArrayExpressionElement)
}

fn literal_string(literal: &StringLiteral<'_>) -> LiteralValueFactPayload {
    LiteralValueFactPayload::String {
        value: literal.value.to_string(),
    }
}

fn literal_number(literal: &NumericLiteral<'_>) -> Option<LiteralValueFactPayload> {
    finite_number(literal.value)
}

fn finite_number(value: f64) -> Option<LiteralValueFactPayload> {
    // Negative zero is deliberately excluded from the JSON-shaped value set: it is
    // a semantically special JS number that JSON cannot round-trip symmetrically.
    (value.is_finite() && !is_negative_zero(value))
        .then_some(LiteralValueFactPayload::Number { value })
}

fn is_negative_zero(value: f64) -> bool {
    value == 0.0 && value.is_sign_negative()
}

fn literal_template(template: &TemplateLiteral<'_>) -> Option<LiteralValueFactPayload> {
    if !template.expressions.is_empty() {
        return None;
    }
    let quasi = template.quasis.first()?;
    let cooked = quasi.value.cooked.as_ref()?;
    Some(LiteralValueFactPayload::String {
        value: cooked.to_string(),
    })
}

fn literal_unary(unary: &UnaryExpression<'_>) -> Option<LiteralValueFactPayload> {
    let Expression::NumericLiteral(literal) = &unary.argument else {
        return None;
    };
    match unary.operator {
        UnaryOperator::UnaryNegation => finite_number(-literal.value),
        UnaryOperator::UnaryPlus => finite_number(literal.value),
        _ => None,
    }
}

fn literal_array(array: &ArrayExpression<'_>) -> Option<LiteralValueFactPayload> {
    let mut elements = Vec::with_capacity(array.elements.len());
    for element in &array.elements {
        elements.push(literal_from_array_element(element)?);
    }
    Some(LiteralValueFactPayload::Array { elements })
}

fn literal_object(object: &ObjectExpression<'_>) -> Option<LiteralValueFactPayload> {
    let mut properties = Vec::with_capacity(object.properties.len());
    for property in &object.properties {
        let ObjectPropertyKind::ObjectProperty(property) = property else {
            return None;
        };
        if property.kind != PropertyKind::Init
            || property.method
            || property.shorthand
            || property.computed
        {
            return None;
        }
        properties.push(LiteralPropertyFactPayload {
            key: literal_key(&property.key)?,
            value: literal_from_expression(&property.value)?,
        });
    }
    Some(LiteralValueFactPayload::Object { properties })
}

fn literal_key(key: &PropertyKey<'_>) -> Option<String> {
    match key {
        PropertyKey::StaticIdentifier(identifier) => Some(identifier.name.to_string()),
        PropertyKey::StringLiteral(literal) => Some(literal.value.to_string()),
        PropertyKey::NumericLiteral(literal) => integer_key(literal.value),
        _ => None,
    }
}

/// Materialize a numeric object key only when its ECMAScript property-key
/// stringification is unambiguous: a finite safe integer. Fractional,
/// out-of-range, or non-finite numeric keys make the whole object opaque rather
/// than emit a key that may not match `Number.prototype.toString`.
fn integer_key(value: f64) -> Option<String> {
    (value.is_finite() && value.fract() == 0.0 && value.abs() < 9_007_199_254_740_992.0)
        .then(|| (value as i64).to_string())
}
