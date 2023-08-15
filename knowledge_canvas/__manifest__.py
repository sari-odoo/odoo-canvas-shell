{
    'name': 'Odoo Canvas',
    'version': '1.0',
    'category': 'Productivity',
    'summary': 'Collaborative sketch pad and data-mapping tool to be integrated with Knowledge app',
    'description': 'A sketch pad and database object integration utility for Odoo',
    'author': 'Odoo Inc.',
    'depends': ['knowledge'],
    'data': [
        'views/knowledge_app_textbox_collaboration.xml',
        'security/ir.model.access.csv',
        'security/ir_rule.xml',
    ],
    'assets': {
        'web.assets_backend': [
            # 'knowledge_canvas/static/src/js/backend/html_field.js',
            'knowledge_canvas/static/src/xml/**/*',
            'knowledge_canvas/static/src/components/**/*',
            'knowledge_canvas/static/src/services/**/*',
            ('remove', 'knowledge/static/src/components/html_field/html_field.js'),
            ('remove', 'knowledge/static/src/components/behaviors/**/*'),
            ('remove', 'knowledge/static/src/services/**/*'),
            ('remove', 'knowledge/static/src/xml/knowledge_editor.xml'),
        ],
        'web_editor.assets_wysiwyg': [
            'knowledge_canvas/static/src/js/wysiwyg.js',
            'knowledge_canvas/static/src/js/knowledge_wysiwyg.js',
            ('remove', 'knowledge/static/src/js/wysiwyg.js'),
        ]
    },
    'installable': True,
    'auto_install': False,
    'application': False,
    'license': 'OPL-1',
    'website': 'https://github.com/OdooInternship/Odoo-Canvas',
}
