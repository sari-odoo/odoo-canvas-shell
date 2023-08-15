from odoo import http

class OdooCanvas(http.Controller):
    @http.route('/canvas', auth='public', website=True, sitemap=True)
    def get_odoo_canvas_home(self,**kw):
        """This is the controller for the canvas home page.

        :param kw: keyword arguments

        :returns: rendered canvas_home template
        :rtype: http.Response
        """

        return http.request.render('odoo_canvas.canvas_home', {})


    @http.route('/canvas/<string:canvas_id>', auth='public', website=True, sitemap=False)
    def get_odoo_canvas_page(self, page_id=None, **kw):
        """This is the controller for the canvas page.
        It renders an owl template with the collaborative canvas.

        :param page_id: the id of the canvas page
        :type page_id: int
        :param kw: keyword arguments

        :returns: rendered canvas_page template
        :rtype: http.Response
        """


        # render an owl template
        return http.request.render('odoo_canvas.canvas_page', {})
