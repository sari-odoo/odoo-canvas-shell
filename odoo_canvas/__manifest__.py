{
    'name': 'Canvas',
    'version': '1.0',
    'category': 'Collaborative/Canvas',
    'summary': 'Collaborative sketch pad and data-mapping tool',
    'description': 'A sketch pad and database object integration utility for Odoo',
    'author': 'Odoo',
    'depends': ['base', 'web', 'website', 'knowledge'],
    'data': [
        'security/ir.model.access.csv',
        'security/security_view.xml',
        'data/element_id_data.xml',
        'data/sketchpad_data.xml',
        'views/app_view.xml',
        'views/menu_view.xml',
        'views/canvas_web_templates.xml',
    ],
    'assets': {
        'web.assets_common': [
            'odoo_canvas/static/src/components/**/*',
            'odoo_canvas/static/src/css/*.scss',
        ],
        'web.assets_backend': [
            'odoo_canvas/static/src/css/*.css',
        ],
        'web_editor.assets_wysiwyg': [
            'odoo_canvas/static/src/js/wysiwyg.js'
        ]
        # @todo: add tests
        # 'web.assets_tests': [
        #     'odoo_canvas/static/tests/tours/**/*',
        # ],
    },
    'installable': True,
    'auto_install': False,
    'application': True,
    'license': 'OPL-1',
    'website': 'https://github.com/sari-odoo/odoo-canvas',
}