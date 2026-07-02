use oxc_ast::ast::{
    JSXAttributeName, JSXAttributeValue, JSXChild, JSXElement, JSXElementName, JSXExpression,
    Program,
};
use oxc_ast_visit::Visit;
use oxc_span::{GetSpan, Span};

use super::FactContext;
use crate::{
    payload::{
        JsxAttributeFactPayload, JsxAttributeValueFactPayload, JsxChildFactPayload,
        JsxTagFactPayload,
    },
    source::SpanConverter,
};

pub(crate) fn collect_jsx_tags(ctx: &mut FactContext<'_, '_>) -> Vec<JsxTagFactPayload> {
    JsxFactBuilder::new(ctx.scoping, ctx.spans).collect_program(ctx.program)
}

struct JsxFactBuilder<'a, 'b> {
    next_id: usize,
    tags: Vec<JsxTagFactPayload>,
    scoping: &'a oxc_semantic::Scoping,
    spans: &'b mut SpanConverter<'a>,
}

impl<'a, 'b> JsxFactBuilder<'a, 'b> {
    fn new(scoping: &'a oxc_semantic::Scoping, spans: &'b mut SpanConverter<'a>) -> Self {
        Self {
            next_id: 1,
            tags: Vec::new(),
            scoping,
            spans,
        }
    }

    fn collect_program(mut self, program: &Program<'a>) -> Vec<JsxTagFactPayload> {
        {
            let mut visitor = RootJsxVisitor { builder: &mut self };
            visitor.visit_program(program);
        }
        self.tags
    }

    fn element(&mut self, element: &JSXElement<'a>, parent_id: Option<usize>) -> usize {
        let id = self.next_id;
        self.next_id += 1;

        let opening = &element.opening_element;
        let (name, kind, binding_id) = jsx_element_name(&opening.name, self.scoping);
        let closing = element.closing_element.as_ref();
        let attributes = self.attributes(&opening.attributes);
        let children = self.children(&element.children, id);

        self.tags.push(JsxTagFactPayload {
            id,
            parent_id,
            name,
            kind,
            binding_id,
            span: self.spans.convert(opening.span),
            name_span: self.spans.convert(opening.name.span()),
            element_span: self.spans.convert(element.span),
            closing_span: closing.map(|closing| self.spans.convert(closing.span)),
            closing_name_span: closing.map(|closing| self.spans.convert(closing.name.span())),
            self_closing: closing.is_none(),
            attributes,
            children,
        });

        id
    }

    fn attributes(
        &mut self,
        attributes: &[oxc_ast::ast::JSXAttributeItem<'a>],
    ) -> Vec<JsxAttributeFactPayload> {
        attributes
            .iter()
            .map(|attribute| self.attribute(attribute))
            .collect()
    }

    fn attribute(
        &mut self,
        attribute: &oxc_ast::ast::JSXAttributeItem<'a>,
    ) -> JsxAttributeFactPayload {
        match attribute {
            oxc_ast::ast::JSXAttributeItem::Attribute(attribute) => {
                let (name, name_span) = jsx_attribute_name(&attribute.name);
                JsxAttributeFactPayload::Attribute {
                    name,
                    name_span: self.spans.convert(name_span),
                    span: self.spans.convert(attribute.span),
                    value: attribute
                        .value
                        .as_ref()
                        .map(|value| self.attribute_value(value)),
                }
            }
            oxc_ast::ast::JSXAttributeItem::SpreadAttribute(spread) => {
                JsxAttributeFactPayload::Spread {
                    span: self.spans.convert(spread.span),
                    expression_span: self.spans.convert(spread.argument.span()),
                }
            }
        }
    }

    fn attribute_value(&mut self, value: &JSXAttributeValue<'a>) -> JsxAttributeValueFactPayload {
        match value {
            JSXAttributeValue::StringLiteral(literal) => JsxAttributeValueFactPayload::String {
                value: literal.value.to_string(),
                span: self.spans.convert(literal.span),
            },
            JSXAttributeValue::ExpressionContainer(container) => {
                self.collect_jsx_in_expression(&container.expression, None);
                JsxAttributeValueFactPayload::Expression {
                    span: self.spans.convert(container.span),
                    expression_span: jsx_expression_span(&container.expression)
                        .map(|span| self.spans.convert(span)),
                }
            }
            JSXAttributeValue::Element(element) => {
                let tag_id = self.element(element, None);
                JsxAttributeValueFactPayload::Element {
                    span: self.spans.convert(element.span),
                    tag_id,
                }
            }
            JSXAttributeValue::Fragment(fragment) => {
                self.collect_jsx_child_roots(&fragment.children);
                JsxAttributeValueFactPayload::Fragment {
                    span: self.spans.convert(fragment.span),
                }
            }
        }
    }

    fn children(
        &mut self,
        children: &[JSXChild<'a>],
        parent_id: usize,
    ) -> Vec<JsxChildFactPayload> {
        children
            .iter()
            .map(|child| self.child(child, parent_id))
            .collect()
    }

    fn child(&mut self, child: &JSXChild<'a>, parent_id: usize) -> JsxChildFactPayload {
        match child {
            JSXChild::Text(text) => JsxChildFactPayload::Text {
                span: self.spans.convert(text.span),
                raw: text.raw.as_ref().unwrap_or(&text.value).to_string(),
                value: Some(text.value.to_string()),
            },
            JSXChild::Element(element) => {
                let tag_id = self.element(element, Some(parent_id));
                JsxChildFactPayload::Element {
                    span: self.spans.convert(element.span),
                    tag_id,
                }
            }
            JSXChild::Fragment(fragment) => JsxChildFactPayload::Fragment {
                span: self.spans.convert(fragment.span),
                children: self.children(&fragment.children, parent_id),
            },
            JSXChild::ExpressionContainer(container) => {
                self.collect_jsx_in_expression(&container.expression, Some(parent_id));
                JsxChildFactPayload::Expression {
                    span: self.spans.convert(container.span),
                    expression_span: jsx_expression_span(&container.expression)
                        .map(|span| self.spans.convert(span)),
                }
            }
            JSXChild::Spread(spread) => {
                self.collect_expression(&spread.expression, Some(parent_id));
                JsxChildFactPayload::Spread {
                    span: self.spans.convert(spread.span),
                    expression_span: self.spans.convert(spread.expression.span()),
                }
            }
        }
    }

    fn collect_jsx_in_expression(
        &mut self,
        expression: &JSXExpression<'a>,
        parent_id: Option<usize>,
    ) {
        match expression {
            JSXExpression::EmptyExpression(_) => {}
            _ => {
                let mut visitor = NestedJsxVisitor {
                    builder: self,
                    parent_id,
                };
                visitor.visit_jsx_expression(expression);
            }
        }
    }

    fn collect_expression(
        &mut self,
        expression: &oxc_ast::ast::Expression<'a>,
        parent_id: Option<usize>,
    ) {
        let mut visitor = NestedJsxVisitor {
            builder: self,
            parent_id,
        };
        visitor.visit_expression(expression);
    }

    fn collect_jsx_child_roots(&mut self, children: &[JSXChild<'a>]) {
        for child in children {
            match child {
                JSXChild::Element(element) => {
                    self.element(element, None);
                }
                JSXChild::Fragment(fragment) => self.collect_jsx_child_roots(&fragment.children),
                JSXChild::ExpressionContainer(container) => {
                    self.collect_jsx_in_expression(&container.expression, None);
                }
                JSXChild::Spread(spread) => self.collect_expression(&spread.expression, None),
                JSXChild::Text(_) => {}
            }
        }
    }
}

struct RootJsxVisitor<'builder, 'a, 'span> {
    builder: &'builder mut JsxFactBuilder<'a, 'span>,
}

impl<'a> Visit<'a> for RootJsxVisitor<'_, 'a, '_> {
    fn visit_jsx_element(&mut self, it: &JSXElement<'a>) {
        self.builder.element(it, None);
    }
}

struct NestedJsxVisitor<'builder, 'a, 'span> {
    builder: &'builder mut JsxFactBuilder<'a, 'span>,
    parent_id: Option<usize>,
}

impl<'a> Visit<'a> for NestedJsxVisitor<'_, 'a, '_> {
    fn visit_jsx_element(&mut self, it: &JSXElement<'a>) {
        self.builder.element(it, self.parent_id);
    }
}

fn jsx_element_name(
    name: &JSXElementName<'_>,
    scoping: &oxc_semantic::Scoping,
) -> (String, &'static str, Option<usize>) {
    match name {
        JSXElementName::Identifier(id) => (id.name.to_string(), "identifier", None),
        JSXElementName::IdentifierReference(id) => (
            id.name.to_string(),
            "identifier",
            binding_id_for_identifier(scoping, id),
        ),
        JSXElementName::NamespacedName(ns) => (
            format!("{}:{}", ns.namespace.name, ns.name.name),
            "namespaced",
            None,
        ),
        JSXElementName::MemberExpression(mem) => (
            get_jsx_member_expr_name(mem),
            "member",
            mem.get_identifier()
                .and_then(|id| binding_id_for_identifier(scoping, id)),
        ),
        JSXElementName::ThisExpression(_) => ("this".to_string(), "identifier", None),
    }
}

fn jsx_attribute_name(name: &JSXAttributeName<'_>) -> (String, Span) {
    match name {
        JSXAttributeName::Identifier(id) => (id.name.to_string(), id.span),
        JSXAttributeName::NamespacedName(ns) => {
            (format!("{}:{}", ns.namespace.name, ns.name.name), ns.span)
        }
    }
}

fn jsx_expression_span(expression: &JSXExpression<'_>) -> Option<Span> {
    match expression {
        JSXExpression::EmptyExpression(_) => None,
        _ => Some(expression.span()),
    }
}

fn binding_id_for_identifier(
    scoping: &oxc_semantic::Scoping,
    id: &oxc_ast::ast::IdentifierReference<'_>,
) -> Option<usize> {
    id.reference_id
        .get()
        .and_then(|reference_id| scoping.get_reference(reference_id).symbol_id())
        .map(|symbol_id| symbol_id.index())
}

fn get_jsx_member_expr_name(mem: &oxc_ast::ast::JSXMemberExpression<'_>) -> String {
    let obj_name = match &mem.object {
        oxc_ast::ast::JSXMemberExpressionObject::IdentifierReference(id) => id.name.to_string(),
        oxc_ast::ast::JSXMemberExpressionObject::MemberExpression(inner) => {
            get_jsx_member_expr_name(inner)
        }
        _ => "unknown".to_string(),
    };
    format!("{}.{}", obj_name, mem.property.name)
}
